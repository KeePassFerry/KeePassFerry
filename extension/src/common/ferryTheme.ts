import type { VuetifyOptions } from "vuetify";

/*
ferryTheme.ts: gemeinsames Erscheinungsbild für alle Vuetify-Oberflächen (Popup, Auswahlliste auf der Seite,
Willkommensseite). Eine einheitliche Fläche (background = surface) statt grauem Hintergrund mit weißen Karten;
Eingabefelder hellgrau gefüllt; Knöpfe ohne Großbuchstaben.
*/

export function ferryVuetifyOptions(theme: string): VuetifyOptions {
    return {
        defaults: {
            VBtn: { rounded: "lg", elevation: 0 },
            VCard: { rounded: "lg", elevation: 0 },
            VAlert: { rounded: "lg" },
            VTextField: { rounded: "lg", variant: "solo-filled", flat: true, density: "comfortable" },
            VTextarea: { rounded: "lg", variant: "solo-filled", flat: true },
            VSelect: { rounded: "lg", variant: "solo-filled", flat: true, density: "comfortable" },
            VCheckbox: { color: "primary", density: "compact" },
            VTooltip: { openDelay: 400 }
        },
        theme: {
            defaultTheme: theme,
            themes: {
                light: {
                    dark: false,
                    colors: {
                        background: "#ffffff",
                        surface: "#ffffff",
                        "surface-variant": "#f1f3f6",
                        "on-surface-variant": "#1f2937",
                        primary: "#2563eb",
                        secondary: "#64748b",
                        tertiary: "#ea580c",
                        error: "#dc2626",
                        info: "#0284c7",
                        success: "#16a34a",
                        warning: "#d97706"
                    }
                },
                dark: {
                    dark: true,
                    colors: {
                        background: "#17191e",
                        surface: "#17191e",
                        "surface-variant": "#24272e",
                        "on-surface-variant": "#e5e7eb",
                        primary: "#60a5fa",
                        secondary: "#94a3b8",
                        tertiary: "#fb923c",
                        error: "#f87171",
                        info: "#38bdf8",
                        success: "#4ade80",
                        warning: "#fbbf24"
                    }
                }
            }
        }
    };
}
