<template>
    <v-app>
        <PasswordGenerator
            :standalone="true"
            :topmost="true"
            @dialog-closed="passwordGeneratorClosed"
            :can-insert="canInsert"
            @copy-to-clipboard="copyToClipboard"
            @insert="insert"
        />
    </v-app>
</template>

<script lang="ts">
import { mapState } from "pinia";
import PasswordGenerator from "../common/components/PasswordGenerator.vue";
import { Port } from "../common/port";
import { Action } from "../common/Action";
import { AddonMessage } from "../common/AddonMessage";
import useStore from "../store";
import "../styles";

export default {
    components: {
        PasswordGenerator
    },
    props: ["canInsert"],
    data: () => ({
        showPasswordGenerator: false
    }),
    computed: {
        ...mapState(useStore, [
            "showGeneratePasswordLink",
            "connectionStatus",
            "connectionStatusDetail",
            "connected",
            "databaseIsOpen"
        ])
    },
    methods: {
        passwordGeneratorClosed: function () {
            Port.postMessage({ action: Action.CloseAllPanels } as AddonMessage);
        },
        insert: function (payload) {
            if (payload?.value) Port.postMessage({ insertGeneratedPassword: payload.value } as AddonMessage);
            Port.postMessage({ action: Action.CloseAllPanels } as AddonMessage);
        },
        copyToClipboard: function (payload) {
            if (payload?.value) {
                Port.postMessage({ copyToClipboard: payload.value } as AddonMessage);
            }
        }
    }
};
</script>

<style></style>
