declare const plugin: {
    id: string;
    name: string;
    description: string;
    register(api: ClawApi): void;
};
export default plugin;
interface ClawApi {
    pluginConfig?: Record<string, unknown>;
    logger: {
        info: (...a: unknown[]) => void;
        error: (...a: unknown[]) => void;
    };
    registerService(s: {
        id: string;
        start: () => void;
        stop: () => void;
    }): void;
    registerTool(t: {
        name: string;
        description: string;
        parameters: unknown;
        execute: (id: unknown, args: Record<string, unknown>) => Promise<unknown>;
    }): void;
}
//# sourceMappingURL=index.d.ts.map