{
  "targets": [
    {
      "target_name": "creation_core_addon",
      "sources": [
        "addon.c",
        "../../creation-core/src/creation_core.cpp"
      ],
      "include_dirs": [
        "../../creation-core/include"
      ],
      "cflags_cc": ["-std=c++20"],
      "xcode_settings": {
        "CLANG_CXX_LANGUAGE_STANDARD": "c++20",
        "MACOSX_DEPLOYMENT_TARGET": "11.0"
      }
    }
  ]
}
