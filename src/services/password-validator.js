/**
 * Validates password complexity
 * @param {string} password 
 * @returns {{isValid: boolean, error?: string}}
 */
export function validatePassword(password) {
    if (!password || password.length < 6) {
        return {
            isValid: false,
            error: 'Das Passwort muss mindestens 6 Zeichen lang sein.'
        };
    }
    // Optional: Add more rules like numbers, special characters etc.
    return { isValid: true };
}
