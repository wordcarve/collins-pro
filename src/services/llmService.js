const OpenAI = require('openai');
const CONFIG = require('../config');
const { validateLlmResponse } = require('../utils/validationUtils');

let openai;

/**
 * 初始化 OpenAI 实例
 * @throws {Error} 当 API 密钥未设置时抛出错误
 */
function initializeOpenAI() {
    if (!CONFIG.OPENAI_API_KEY) {
        throw new Error('错误: OPENAI_API_KEY 环境变量未设置。');
    }

    openai = new OpenAI({
        apiKey: CONFIG.OPENAI_API_KEY,
        baseURL: CONFIG.OPENAI_BASE_URL,
    });
    console.log('OpenAI API 配置完成。');
}

/**
 * 调用 LLM API
 * @param {string} prompt - 提示语
 * @param {string} model - 模型名称
 * @returns {Promise<Object>} LLM 响应
 */
async function callLlmApi(prompt, model = CONFIG.MODEL) {
    if (!openai) {
        throw new Error('OpenAI 实例未初始化。');
    }

    const chatCompletion = await openai.chat.completions.create({
        model: model,
        messages: [
            { role: "system", content: "Output JSON Only." },
            { role: "user", content: prompt }
        ],
        temperature: CONFIG.TEMPERATURE,
        response_format: { type: "json_object" },
    });
    return chatCompletion.choices[0].message.content;
}

module.exports = {
    initializeOpenAI,
    callLlmApi
};
