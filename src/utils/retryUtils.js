/**
 * 通用重试操作函数
 * @param {Function} operation - 要执行的异步操作
 * @param {number} maxRetries - 最大重试次数
 * @param {number} delay - 重试延迟时间（毫秒）
 * @returns {Promise} 操作结果
 */
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
    throw lastError;
}

module.exports = {
    retryOperation
};
