/* Minimal standalone gateway-contract fixture.
 * Repository CI loads the real root llm-bridge.js instead whenever it is present.
 */
(() => {
  "use strict";
  function create() {
    const providers = new Map();
    let activeProvider = "";
    function register(name, adapter) {
      providers.set(name, adapter);
      if (!activeProvider) activeProvider = name;
      return { id: name, active: activeProvider === name };
    }
    function active() {
      const adapter = providers.get(activeProvider);
      if (!adapter) throw new Error("No active provider");
      return adapter;
    }
    async function generate(request) {
      const result = await active().generate(request);
      if (typeof result !== "string" || !result.trim()) throw new Error("Empty provider response");
      return result.trim().slice(0, 12000);
    }
    async function generateDetailed(request) {
      const adapter = active();
      const value = typeof adapter.generateDetailed === "function"
        ? await adapter.generateDetailed(request) : await adapter.generate(request);
      const source = typeof value === "string" ? { reply: value } : value;
      if (!source || typeof source.reply !== "string" || !source.reply.trim()) throw new Error("Empty provider response");
      return {
        reply: source.reply.trim().slice(0, 12000),
        model: source.model || null,
        requestedModel: source.requestedModel || null,
        fallbackUsed: typeof source.fallbackUsed === "boolean" ? source.fallbackUsed : null,
        usage: source.usage || null
      };
    }
    function select(name) {
      if (!providers.has(name)) throw new Error("Provider not registered");
      activeProvider = name;
      return { provider: activeProvider };
    }
    return { register, select, generate, generateDetailed };
  }
  function buildRequest(input) {
    return { schema: "NEUROGENESIS_LLM_REQUEST_V1", messages: [{ role: "user", content: input }] };
  }
  window.NGLLMBridge = { create, buildRequest };
})();
