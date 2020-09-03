export type ErrorCode = 'PathIsNotCorrect' | 'PathIsNotSupported' | 'CouldNotReadFile';

/**
 * Extends Error type to have an error code in addition to the Error's message.
 */
export class validatePathError extends Error {
    private errorCode: ErrorCode;
  
    constructor (message: string, errorCode: ErrorCode) {
        super(message);
        this.errorCode = errorCode;
    }

    getErrorCode(): ErrorCode {
        return this.errorCode;
    }
}
  