import i18next from 'i18next';

/**
 * Validates password complexity
 * @param {string} password 
 * @returns {{isValid: boolean, error?: string}}
 */
export function validatePassword(password) {
    if (!password || password.length < 10) {
        return {
            isValid: false,
            error: i18next.t('auth.validation.passwordLength', { defaultValue: 'Das Passwort muss mindestens 10 Zeichen lang sein.' })
        };
    }
    const hasUppercase = /[A-Z]/.test(password);
    const hasLowercase = /[a-z]/.test(password);
    const hasDigit = /[0-9]/.test(password);
    if (!hasUppercase || !hasLowercase || !hasDigit) {
        return {
            isValid: false,
            error: i18next.t('auth.validation.passwordComplexity', { defaultValue: 'Das Passwort muss Grossbuchstaben, Kleinbuchstaben und Ziffern enthalten.' })
        };
    }
    return { isValid: true };
}
