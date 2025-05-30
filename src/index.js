const fs = require('fs');
const fsPromises = require('fs/promises');
const csv = require('csv-parser');
const CONFIG = require('./config');
const { retryOperation } = require('./utils/retryUtils');
const { validateLlmResponse } = require('./utils/validationUtils');
const { writeToJsonFile, loadExistingEntries, initializeOutputDir } = require('./utils/fileUtils');
const { initializeOpenAI, callLlmApi } = require('./services/llmService');
const { concurrentQueue } = require('./services/queueService');

/**
 * 处理单个词条
 * @param {Object} task - 包含 word 和 senses 的任务对象
 * @param {string} promptTemplate - 提示语模板
 */
async function processWord(task, promptTemplate) {
    const { word, senses } = task;
    const modelToUse = CONFIG.MODEL;

    try {
        await retryOperation(async () => {
            const prompt = promptTemplate.replace('JSON_HERE', senses);
            const llmResponseContent = await callLlmApi(prompt, modelToUse);

            let parsedLlmResponse;
            try {
                parsedLlmResponse = JSON.parse(llmResponseContent);
                validateLlmResponse(parsedLlmResponse);
            } catch (jsonError) {
                throw new Error(`LLM 返回结果不是有效的 JSON 或缺少字段: ${jsonError.message}. 原始响应: ${llmResponseContent}`);
            }

            const firstChar = word.charAt(0).toUpperCase();
            const entry = { word: word, llmResponse: parsedLlmResponse };
            await writeToJsonFile(firstChar, entry);
            console.log(`已处理并保存词条: ${word}`);
        });
    } catch (error) {
        console.error(`处理词条 "${word}" 经过多次重试后失败: ${error.message}`);
    }
}

async function main() {
    console.log('开始处理...');

    try {
        // 初始化必要的组件和目录
        await initializeOutputDir();
        initializeOpenAI();

        // 读取提示语模板
        const promptTemplate = await fsPromises.readFile(CONFIG.PROMPT_FILE, 'utf-8');

        // 加载现有词条进行去重
        const existingEntries = await loadExistingEntries();
        console.log(`已加载 ${existingEntries.size} 个现有词条进行去重。`);

        const tasksToProcess = [];
        const parser = fs.createReadStream(CONFIG.PROTO_WORDS_FILE).pipe(csv());

        // 从 CSV 文件读取词条
        for await (const row of parser) {
            const word = row.word?.trim();
            let senses = row.senses?.trim();

            if (word && !existingEntries.has(word.toLowerCase())) {
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

        // 创建任务队列
        const tasks = tasksToProcess.map(task => 
            () => processWord(task, promptTemplate)
        );

        console.log(`开始并发处理 ${tasks.length} 个 LLM 调用...`);
        await concurrentQueue(tasks, CONFIG.CONCURRENT_LIMIT, (progress, status) => {
            console.log(`处理进度: ${progress}% | 已完成: ${status.completedTasks} | 失败: ${status.failedTasks} | 队列中: ${status.queueLength} | 运行中: ${status.runningTasks}`);
        });
        console.log('所有 LLM 调用处理完成。');

    } catch (error) {
        console.error('程序执行出错:', error);
        process.exit(1);
    }
}

// 运行主程序
main().catch(console.error);
