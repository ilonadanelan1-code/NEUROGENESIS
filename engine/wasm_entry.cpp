// The Emscripten target has no process entry point. Exported C ABI functions
// from neuro_wasm.cpp are the module's public interface.
extern "C" int ng_wasm_module_anchor() {
    return 1;
}
