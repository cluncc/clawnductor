export declare const MAX_NAME_LENGTH = 100;
export declare const MAX_AGENT_NAME_LENGTH = 50;
export declare const MAX_CWD_LENGTH = 500;
export declare const MAX_REGEX_LENGTH = 500;
export declare const MAX_STRING_FIELD_LENGTH = 50000;
export declare const MAX_TIMEOUT_MS: number;
export declare const MIN_TIMEOUT_MS = 1000;
export declare function validateName(value: unknown, field?: string): string;
export declare function validateAgentName(value: unknown, field?: string): string;
export declare function validateCwd(value: unknown, field?: string): string;
export declare function validateRegex(value: unknown, field?: string): string;
export declare function validatePermissionMode(value: unknown, field?: string): string;
export declare function validateEffort(value: unknown, field?: string): string;
export declare function validateTimeout(value: unknown, field?: string): number;
export declare function validatePositiveInt(value: unknown, field: string, max?: number): number;
export declare function validateStringField(value: unknown, field: string, maxLength?: number): string;
export declare function validateStringArray(value: unknown, field: string, maxItems?: number): string[];
export declare function validateBoolean(value: unknown, field: string): boolean;
//# sourceMappingURL=validation.d.ts.map