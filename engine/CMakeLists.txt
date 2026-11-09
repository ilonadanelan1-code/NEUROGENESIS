cmake_minimum_required(VERSION 3.16)
project(neurogenesis_core LANGUAGES CXX)

option(NG_BUILD_WASM "Build the browser WebAssembly module with Emscripten" OFF)

add_library(neurogenesis_core STATIC neuro_core.cpp neuro_wasm.cpp)
target_include_directories(neurogenesis_core PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})
target_compile_features(neurogenesis_core PUBLIC cxx_std_17)
set_target_properties(neurogenesis_core PROPERTIES
    CXX_EXTENSIONS OFF
    POSITION_INDEPENDENT_CODE ON
)

if(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
    target_compile_options(neurogenesis_core PRIVATE -Wall -Wextra -Wpedantic -Werror)
endif()

include(CTest)
if(BUILD_TESTING)
    add_executable(neurogenesis_core_test neuro_core.test.cpp)
    target_link_libraries(neurogenesis_core_test PRIVATE neurogenesis_core)
    if(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
        target_compile_options(neurogenesis_core_test PRIVATE -Wall -Wextra -Wpedantic -Werror)
    endif()
    add_test(NAME neurogenesis_core_test COMMAND neurogenesis_core_test)
endif()

if(EMSCRIPTEN AND NG_BUILD_WASM)
    file(MAKE_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/../dist")
    add_executable(neurogenesis_wasm wasm_entry.cpp)
    target_link_libraries(neurogenesis_wasm PRIVATE neurogenesis_core)
    target_compile_features(neurogenesis_wasm PRIVATE cxx_std_17)
    target_compile_options(neurogenesis_core PRIVATE -fexceptions)
    target_compile_options(neurogenesis_wasm PRIVATE -fexceptions)
    target_link_options(neurogenesis_wasm PRIVATE
        -fexceptions
        "-sDISABLE_EXCEPTION_CATCHING=0"
        "--no-entry"
        "-sMODULARIZE=1"
        "-sEXPORT_ES6=1"
        "-sEXPORT_NAME=NeurogenesisModule"
        "-sENVIRONMENT=web,worker,node"
        "-sALLOW_MEMORY_GROWTH=1"
        "-sFILESYSTEM=0"
        "-sEXPORTED_RUNTIME_METHODS=['cwrap']"
        "-sEXPORTED_FUNCTIONS=['_ng_brain_create','_ng_brain_destroy','_ng_brain_add_neuron','_ng_brain_add_synapse','_ng_brain_set_synapse_weight','_ng_brain_set_synapse_eligibility','_ng_brain_reset_eligibility','_ng_brain_stimulate','_ng_brain_learn','_ng_brain_learn_from_reward','_ng_brain_learn_contrastive_reward','_ng_brain_step','_ng_brain_neuron_count','_ng_brain_synapse_count','_ng_brain_neuron_id_at','_ng_brain_neuron_kind_at','_ng_brain_neuron_activation_at','_ng_brain_neuron_excitability_at','_ng_brain_neuron_x_at','_ng_brain_neuron_y_at','_ng_brain_synapse_from_at','_ng_brain_synapse_to_at','_ng_brain_synapse_weight_at','_ng_brain_synapse_signal_at','_ng_brain_synapse_eligibility_at','_malloc','_free']"
    )
    set_target_properties(neurogenesis_wasm PROPERTIES
        OUTPUT_NAME "neurogenesis"
        SUFFIX ".mjs"
        RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/../dist"
    )
endif()
