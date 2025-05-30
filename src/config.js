require('dotenv').config();

const CONFIG = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    MODEL: process.env.OPENAI_MODEL || 'gpt-4o',
    CONCURRENT_LIMIT: parseInt(process.env.CONCURRENT_LIMIT || '5', 10),
    TEMPERATURE: parseFloat(process.env.TEMPERATURE || '0.7'),
    COLLINS_API_BASE: 'https://collins.xna.asia/api/words',
    
    // 文件路径配置
    PROMPT_FILE: 'prompt.txt',
    PROTO_WORDS_FILE: 'protoWords.csv',
    OUTPUT_DIR: 'output'
};

module.exports = CONFIG;
