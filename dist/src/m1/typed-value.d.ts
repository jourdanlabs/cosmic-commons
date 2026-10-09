import type { FieldType } from './validate.ts';
export declare function assertTypedFieldValue(value: unknown, type: FieldType, path: string): void;
/** Independent canonical equality for oracle tests (not importing production canonicalize for expected state). */
export declare function typedValueIdentity(value: unknown, type: FieldType): string;
