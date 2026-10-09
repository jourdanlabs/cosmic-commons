export declare class M1InvalidInputError extends Error {
    readonly code: string;
    readonly path: string;
    constructor(code: string, path: string, message: string);
}
export declare function invalidInput(code: string, path: string, message: string): never;
export declare function exposeInvalidInput(error: unknown): {
    code: string;
    path: string;
    message: string;
};
