const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');
const csv = require('csv-parser');
const OpenAI = require('openai');
require('dotenv').config();

// 默认配置
const CONFIG = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    MODEL: process.env.OPENAI_MODEL || 'gpt-4o',
    CONCURRENT_LIMIT: parseInt(process.env.CONCURRENT_LIMIT || '10', 10),
    TEMPERATURE: parseFloat(process.env.TEMPERATURE || '0.7'),
};

const PROMPT_FILE = 'prompt.txt';
const PROTO_WORDS_FILE = 'protoWords.csv';
const OUTPUT_DIR = 'output';
const CONCURRENT_LIMIT = 5;

let openai;

async function callLlmApi(prompt, model = "gpt-3.5-turbo") {
    if (!openai) {
        throw new Error('OpenAI 实例未初始化。');
    }

    const chatCompletion = await openai.chat.completions.create({
        model: model || CONFIG.MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: CONFIG.TEMPERATURE,
        response_format: { type: "json_object" },
    });
    return chatCompletion.choices[0].message.content;
}

function validateLlmResponse(responseJson) {
    const requiredFields = ['word', 'forms', 'meaning', 'senses'];

    for (const field of requiredFields) {
        if (!(field in responseJson)) {
            throw new Error(`缺少必需字段: ${field}`);
        }
    }

    if (!Array.isArray(responseJson.senses)) {
        throw new Error('字段 "senses" 必须是一个数组');
    }

    if (!Array.isArray(responseJson.usages)) {
        throw new Error('字段 "usages" 必须是一个数组');
    }
}

async function concurrentQueue(tasks, limit) {
    const executing = [];
    let i = 0;

    const executeNext = async () => {
        if (i >= tasks.length) {
            return;
        }

        const task = tasks[i++];
        const p = task();
        executing.push(p);

        p.finally(() => {
            executing.splice(executing.indexOf(p), 1);
        });

        if (executing.length >= limit) {
            await Promise.race(executing);
        }
        await executeNext();
    };

    for (let j = 0; j < limit && j < tasks.length; j++) {
        executeNext();
    }

    await Promise.all(executing);
}

async function writeToJsonFile(char, entry) {
    const outputFile = path.join(OUTPUT_DIR, `${char}.json`);
    try {
        let entries = [];
        try {
            const data = await fsPromises.readFile(outputFile, 'utf-8');
            entries = JSON.parse(data);
        } catch (error) {
            // 如果文件不存在或者内容为空，使用空数组
        }
        entries.push(entry);
        await fsPromises.writeFile(outputFile, JSON.stringify(entries, null, 2), 'utf-8');
    } catch (error) {
        console.error(`写入文件 ${outputFile} 时发生错误:`, error);
        throw error;
    }
}

async function main() {
    console.log('开始处理...');

    await fsPromises.mkdir(OUTPUT_DIR, { recursive: true });

    if (!CONFIG.OPENAI_API_KEY) {
        console.error('错误: OPENAI_API_KEY 环境变量未设置。');
        process.exit(1);
    }

    openai = new OpenAI({
        apiKey: CONFIG.OPENAI_API_KEY,
        baseURL: CONFIG.OPENAI_BASE_URL,
    });
    console.log('OpenAI API 配置完成。');

    const promptTemplate = await fsPromises.readFile(PROMPT_FILE, 'utf-8');

    const existingEntries = new Set();
    const resultsByChar = {};

    for (let i = 0; i < 26; i++) {
        const char = String.fromCharCode(65 + i);
        const outputFile = path.join(OUTPUT_DIR, `${char}.json`);
        try {
            const data = await fsPromises.readFile(outputFile, 'utf-8');
            const entries = JSON.parse(data);
            entries.forEach(entry => existingEntries.add(entry.word.toLowerCase()));
            resultsByChar[char] = entries;
        } catch (error) {
            resultsByChar[char] = [];
        }
    }
    console.log(`已加载 ${existingEntries.size} 个现有词条进行去重。`);

    const tasksToProcess = [];
    const parser = fs.createReadStream(PROTO_WORDS_FILE).pipe(csv());

    for await (const row of parser) {
        const word = row.word;
        if (!existingEntries.has(word.toLowerCase())) {
            tasksToProcess.push({ word: word, senses: row.senses });
        }
    }
    console.log(`待处理词条数量: ${tasksToProcess.length}`);

    if (tasksToProcess.length === 0) {
        console.log('没有新的词条需要处理。');
        return;
    }

    const llmCallPromises = [];
    
    for (const task of tasksToProcess) {
        llmCallPromises.push(async () => {
            const { word, senses } = task;
            const modelToUse = CONFIG.MODEL;

            try {
                const prompt = promptTemplate.replace('JSON_HERE', senses);
                const llmResponseContent = await callLlmApi(prompt, modelToUse);

                let parsedLlmResponse;
                try {
                    parsedLlmResponse = JSON.parse(llmResponseContent);
                    validateLlmResponse(parsedLlmResponse);
                } catch (jsonError) {
                    throw new Error(`LLM 返回结果不是有效的 JSON 或缺少字段: ${jsonError.message}. `);
                }
                
                const firstChar = word.charAt(0).toUpperCase();
                const entry = { word: word, llmResponse: parsedLlmResponse };
                await writeToJsonFile(firstChar, entry);
                console.log(`已处理并保存词条: ${word}`);

            } catch (error) {
                console.error(`处理词条 "${word}" 时发生错误: ${error.message}`);
            }
        });
    }

    console.log(`开始并发处理 ${llmCallPromises.length} 个 LLM 调用...`);
    await concurrentQueue(llmCallPromises, CONFIG.CONCURRENT_LIMIT);
    console.log('所有 LLM 调用处理完成。');

    console.log('所有处理完成。');
}

main().catch(console.error);