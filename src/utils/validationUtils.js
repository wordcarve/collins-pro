/**
 * 验证 LLM 响应数据的格式
 * @param {Object} responseJson - LLM 返回的响应数据
 * @throws {Error} 当缺少必需字段或格式不正确时抛出错误
 */
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
}

module.exports = {
    validateLlmResponse
};
