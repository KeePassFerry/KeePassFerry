import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import vue from "eslint-plugin-vue";
import vuetify from "eslint-plugin-vuetify";
import stylistic from "@stylistic/eslint-plugin";
import prettier from "eslint-config-prettier";

// Inline-Elemente wie in eslint-plugin-vue (dessen Liste ist seit Version 10 nicht mehr von außen ladbar)
const INLINE_ELEMENTS = [
    "a", "abbr", "audio", "b", "bdi", "bdo", "canvas", "cite", "code", "data", "del", "dfn", "em", "i", "iframe", "ins", "kbd", "label", "map",
    "mark", "noscript", "object", "output", "picture", "q", "ruby", "s", "samp", "small", "span", "strong", "sub", "sup", "svg", "time", "u",
    "var", "video"
];
const htmlElementContentNewlineIgnores = ["v-btn", "pre", "textarea", "v-icon", ...INLINE_ELEMENTS];

export default tseslint.config(
    {
        ignores: ["**/*.d.ts", "dist/**", "extension/**", "node_modules/**", "public/**", "src/lib/**", "lib/**", "**/*.js", "**/*.cjs"]
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    ...vue.configs["flat/recommended"],
    ...vuetify.configs["flat/base"],
    prettier,
    {
        // Alte Ausnahmekommentare im Bestand nicht anmahnen
        linterOptions: { reportUnusedDisableDirectives: "off" },
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.webextensions,
                browser: "readonly",
                chrome: "readonly"
            },
            parserOptions: {
                parser: tseslint.parser,
                project: "tsconfig.json",
                tsconfigRootDir: import.meta.dirname,
                sourceType: "module",
                extraFileExtensions: [".vue"]
            }
        },
        plugins: {
            "@stylistic": stylistic
        },
        rules: {
            // TypeScript (vue-tsc) prüft undefinierte Namen selbst und kennt die Auto-Imports ($STR, reactive …);
            // typescript-eslint rät, no-undef in TS-Projekten abzuschalten
            "no-undef": "off",
            // Neu in den ESLint-10-Empfehlungen; der Bestand setzt Variablen bewusst vor
            "no-useless-assignment": "off",
            "vue/html-indent": "off",
            "vue/max-attributes-per-line": "off",
            "vue/html-closing-bracket-newline": "off",
            "vue/html-self-closing": "off",
            "vue/require-prop-types": "off",
            // Kurze Elemente stehen im Projekt in einer Zeile (<p class="hint">{{ … }}</p>)
            "vue/singleline-html-element-content-newline": "off",
            "vue/multiline-html-element-content-newline": [
                "error",
                {
                    ignoreWhenEmpty: true,
                    ignores: htmlElementContentNewlineIgnores,
                    allowEmptyLines: false
                }
            ],
            "vue/attribute-hyphenation": "off",
            "vue/multi-word-component-names": "off",
            // Tests legen Platzhalter-Komponenten neben der geprüften an
            "vue/one-component-per-file": "off",
            "@typescript-eslint/consistent-type-assertions": "error",
            "@stylistic/member-delimiter-style": [
                "error",
                {
                    multiline: { delimiter: "semi", requireLast: true },
                    singleline: { delimiter: "semi", requireLast: false }
                }
            ],
            "@stylistic/quotes": ["error", "double", { avoidEscape: true }],
            "@stylistic/semi": ["error", "always"],
            "arrow-body-style": "error",
            "@stylistic/arrow-parens": ["error", "as-needed"],
            "camelcase": "error",
            "@stylistic/comma-dangle": "error",
            "@stylistic/eol-last": "error",
            "id-denylist": ["error", "any", "Number", "number", "String", "string", "Boolean", "boolean"],
            "id-match": "error",
            "@stylistic/max-len": ["error", { code: 250 }],
            "@stylistic/new-parens": "error",
            "no-duplicate-case": "error",
            "no-eval": "error",
            "@stylistic/no-multiple-empty-lines": ["error", { max: 2 }],
            "no-redeclare": "error",
            "no-sequences": "off",
            "no-shadow": "off",
            "@typescript-eslint/no-shadow": "error",
            "no-throw-literal": "error",
            "@stylistic/no-trailing-spaces": ["error", { ignoreComments: true }],
            "no-undef-init": "error",
            "no-underscore-dangle": "off",
            "no-unsafe-finally": "error",
            "no-unused-expressions": "off",
            "@typescript-eslint/no-unused-expressions": ["error", { allowShortCircuit: true }],
            "no-var": "error",
            "one-var": ["error", "never"],
            "prefer-const": "error",
            "curly": [2, "multi-line"],
            "@typescript-eslint/explicit-module-boundary-types": "off",
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/no-unused-vars": "off"
        }
    }
);
