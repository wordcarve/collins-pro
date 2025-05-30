const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');
const csv = require('csv-parser');
const fetch = require('node-fetch'); // 用于 API 请求
const OpenAI = require('openai');
require('dotenv').config(); // 加载环境变量

// 重试工具函数
async function retryOperation(operation, maxRetries = 3, delay = 5000) {
    let lastError;
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            if (i < maxRetries - 1) {
                console.log(`操作失败，${delay / 1000}秒后重试 (${i + 1}/${maxRetries}):`, error.message);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    throw lastError; // 达到最大重试次数后抛出最后的错误
}

// 默认配置
const CONFIG = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    MODEL: process.env.OPENAI_MODEL || 'gpt-4o',
    CONCURRENT_LIMIT: parseInt(process.env.CONCURRENT_LIMIT || '5', 10),
    TEMPERATURE: parseFloat(process.env.TEMPERATURE || '0.7'),
    COLLINS_API_BASE: 'https://collins.xna.asia/api/words', // Collins API 基地址
};

const PROMPT_FILE = 'prompt.txt'; // 提示语文件
const PROTO_WORDS_FILE = 'protoWords.csv'; // 原始单词 CSV 文件
const OUTPUT_DIR = 'output'; // 输出目录

let openai; // OpenAI 实例

// 调用 LLM API
async function callLlmApi(prompt, model = CONFIG.MODEL) {
    if (!openai) {
        throw new Error('OpenAI 实例未初始化。');
    }

    const chatCompletion = await openai.chat.completions.create({
        model: model,
        messages: [
            { role: "system", content: "Output JSON Only." }, // 系统消息，要求输出 JSON
            { role: "user", content: prompt } // 用户提示
        ],
        temperature: CONFIG.TEMPERATURE,
        response_format: { type: "json_object" }, // 指定返回 JSON 对象
    });
    return chatCompletion.choices[0].message.content;
}

// 验证 LLM 响应
function validateLlmResponse(responseJson) {
    const requiredFields = ['word', 'forms', 'meaning', 'senses']; // 必需字段

    for (const field of requiredFields) {
        if (!(field in responseJson)) {
            throw new Error(`缺少必需字段: ${field}`);
        }
    }

    if (!Array.isArray(responseJson.senses)) {
        throw new Error('字段 "senses" 必须是一个数组');
    }
}

// 并发队列处理函数
async function concurrentQueue(tasks, limit) {
    const executing = []; // 正在执行的任务
    let i = 0;

    const executeNext = async () => {
        if (i >= tasks.length) {
            return; // 所有任务已启动
        }

        const task = tasks[i++]; // 获取下一个任务
        const p = task(); // 执行任务并获取 Promise
        executing.push(p); // 将 Promise 添加到正在执行的列表

        p.finally(() => {
            // 任务完成后从正在执行的列表中移除
            executing.splice(executing.indexOf(p), 1);
        });

        if (executing.length >= limit) {
            await Promise.race(executing); // 如果达到并发限制，等待最快完成的任务
        }
        await executeNext(); // 继续执行下一个任务
    };

    // 启动初始任务
    for (let j = 0; j < limit && j < tasks.length; j++) {
        executeNext();
    }

    await Promise.all(executing); // 等待所有任务完成
}

// 写入 JSON 文件
async function writeToJsonFile(char, entry) {
    const outputFile = path.join(OUTPUT_DIR, `${char}.json`);
    try {
        let entries = [];
        try {
            // 尝试读取现有文件内容
            const data = await fsPromises.readFile(outputFile, 'utf-8');
            entries = JSON.parse(data);
        } catch (error) {
            // 如果文件不存在或内容为空，则忽略错误，使用空数组
            if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) {
                throw error;
            }
        }
        entries.push(entry); // 添加新词条
        // 写入更新后的内容
        await fsPromises.writeFile(outputFile, JSON.stringify(entries, null, 2), 'utf-8');
    } catch (error) {
        console.error(`写入文件 ${outputFile} 时发生错误:`, error);
        throw error;
    }
}

// 主函数
async function main() {
    console.log('开始处理...');

    // 创建输出目录
    await fsPromises.mkdir(OUTPUT_DIR, { recursive: true });

    // 检查 OpenAI API 密钥
    if (!CONFIG.OPENAI_API_KEY) {
        console.error('错误: OPENAI_API_KEY 环境变量未设置。');
        process.exit(1);
    }

    // 初始化 OpenAI 实例
    openai = new OpenAI({
        apiKey: CONFIG.OPENAI_API_KEY,
        baseURL: CONFIG.OPENAI_BASE_URL,
    });
    console.log('OpenAI API 配置完成。');

    // 读取提示语模板
    const promptTemplate = await fsPromises.readFile(PROMPT_FILE, 'utf-8');

    // 加载已存在的词条进行去重
    const existingEntries = new Set();
    for (let i = 0; i < 26; i++) {
        const char = String.fromCharCode(65 + i); // 大写字母 A-Z
        const outputFile = path.join(OUTPUT_DIR, `${char}.json`);
        try {
            const data = await fsPromises.readFile(outputFile, 'utf-8');
            const entries = JSON.parse(data);
            entries.forEach(entry => existingEntries.add(entry.word.toLowerCase()));
        } catch (error) {
            // 文件不存在或解析错误，忽略
        }
    }
    console.log(`已加载 ${existingEntries.size} 个现有词条进行去重。`);

    const tasksToProcess = [];
    const parser = fs.createReadStream(PROTO_WORDS_FILE).pipe(csv());

    // 从 CSV 文件读取词条
    for await (const row of parser) {
        const word = row.word?.trim();
        let senses = row.senses?.trim(); // 获取 senses 字段

        if (word && !existingEntries.has(word.toLowerCase())) {
            // 移除 senses 字段的首尾方括号
            if (senses && senses.startsWith('[') && senses.endsWith(']')) {
                senses = senses.substring(1, senses.length - 1);
            }
            tasksToProcess.push({ word, senses });
        }
    }
    console.log(`待处理词条数量: ${tasksToProcess.length}`);

    if (tasksToProcess.length === 0) {
        console.log('没有新的词条需要处理。');
        return;
    }

    const llmCallPromises = [];

    // 为每个待处理词条创建 LLM 调用任务
    for (const task of tasksToProcess) {
        llmCallPromises.push(async () => {
            const { word, senses } = task;
            const modelToUse = CONFIG.MODEL;

            try {
                // 重试操作，包括 LLM 调用和文件写入
                await retryOperation(async () => {
                    // 使用从 CSV 中读取的 senses 作为提示的一部分
                    const prompt = promptTemplate.replace('JSON_HERE', senses);
                    const llmResponseContent = await callLlmApi(prompt, modelToUse);

                    let parsedLlmResponse;
                    try {
                        parsedLlmResponse = JSON.parse(llmResponseContent);
                        validateLlmResponse(parsedLlmResponse); // 验证 LLM 响应格式
                    } catch (jsonError) {
                        throw new Error(`LLM 返回结果不是有效的 JSON 或缺少字段: ${jsonError.message}. 原始响应: ${llmResponseContent}`);
                    }

                    const firstChar = word.charAt(0).toUpperCase();
                    const entry = { word: word, llmResponse: parsedLlmResponse };
                    await writeToJsonFile(firstChar, entry); // 写入 JSON 文件
                    console.log(`已处理并保存词条: ${word}`);
                });
            } catch (error) {
                console.error(`处理词条 "${word}" 经过多次重试后失败: ${error.message}`);
            }
        });
    }

    console.log(`开始并发处理 ${llmCallPromises.length} 个 LLM 调用...`);
    await concurrentQueue(llmCallPromises, CONFIG.CONCURRENT_LIMIT); // 运行并发队列
    console.log('所有 LLM 调用处理完成。');

    console.log('所有处理完成。');
}

// 运行主函数并捕获任何未处理的错误
main().catch(console.error);