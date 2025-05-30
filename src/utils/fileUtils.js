const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');
const CONFIG = require('../config');

/**
 * 写入 JSON 文件
 * @param {string} char - 首字母（用于文件名）
 * @param {Object} entry - 要写入的数据
 */
async function writeToJsonFile(char, entry) {
    const outputFile = path.join(CONFIG.OUTPUT_DIR, `${char}.json`);
    try {
        let entries = [];
        try {
            const data = await fsPromises.readFile(outputFile, 'utf-8');
            entries = JSON.parse(data);
        } catch (error) {
            if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) {
                throw error;
            }
        }
        entries.push(entry);
        await fsPromises.writeFile(outputFile, JSON.stringify(entries, null, 2), 'utf-8');
    } catch (error) {
        console.error(`写入文件 ${outputFile} 时发生错误:`, error);
        throw error;
    }
}

/**
 * 加载现有词条用于去重
 * @returns {Set} 现有词条集合
 */
async function loadExistingEntries() {
    const existingEntries = new Set();
    for (let i = 0; i < 26; i++) {
        const char = String.fromCharCode(65 + i);
        const outputFile = path.join(CONFIG.OUTPUT_DIR, `${char}.json`);
        try {
            const data = await fsPromises.readFile(outputFile, 'utf-8');
            const entries = JSON.parse(data);
            entries.forEach(entry => existingEntries.add(entry.word.toLowerCase()));
        } catch (error) {
            // 文件不存在或解析错误，忽略
        }
    }
    return existingEntries;
}

/**
 * 初始化输出目录
 */
async function initializeOutputDir() {
    await fsPromises.mkdir(CONFIG.OUTPUT_DIR, { recursive: true });
}

module.exports = {
    writeToJsonFile,
    loadExistingEntries,
    initializeOutputDir
};
