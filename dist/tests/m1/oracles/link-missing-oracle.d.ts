export declare function expectedMissingDependencies(items: {
    id: string;
    dependsOn: string[];
}[]): {
    itemId: string;
    missing: string[];
}[];
