<template>
    <div class="ferry-note ferry-notification">
        <tabler-info-circle class="ferry-ico" />
        <div class="ferry-note-text">
            <p v-for="(msg, index) of notification.messages" :key="index">{{ msg }}</p>
            <div v-if="notification.buttons?.length" class="ferry-notification-actions">
                <v-btn
                    v-for="(but, index) of notification.buttons" :id="but.id" :key="index" size="small"
                    :variant="index === 0 ? 'tonal' : 'text'" color="primary"
                    @click="dispatchActionResponse(notification.id, but.action, but.values)">
                    {{ but.label }}
                    <v-tooltip v-if="but.tooltip" location="top" activator="parent">{{ but.tooltip }}</v-tooltip>
                </v-btn>
            </div>
        </div>
        <button type="button" class="ferry-ib" :aria-label="$i18n('close')" @click="closeNotification(notification.id)">
            <tabler-x class="ferry-ico" />
        </button>
    </div>
</template>

<style>
.ferry-notification {
    align-items: flex-start;
}
.ferry-notification > .ferry-ico {
    margin-top: 2px;
}
.ferry-notification p {
    margin: 0 0 4px;
}
.ferry-notification-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 6px;
}
</style>

<script lang="ts">
import { ButtonAction } from "../../common/Button";
import { configManager } from "../../common/ConfigManager";
import { AddonMessage } from "../../common/AddonMessage";
import { Port } from "../../common/port";
import { tooltipDelay } from "../../common/Timings";
//import useStore from "../../store";

export default {
    props: ["notification"],
    // setup () {
    //     const { updateSaveState } = useStore();
    //     return { updateSaveState };
    // },
    data: () => ({
        tooltipDelay
    }),
    methods: {
        dispatchActionResponse(id: string, action: ButtonAction, data: { [id: string]: string }) {
            const pm = Port.postMessage;
            switch (action) {
                case "enableHighSecurityKPRPCConnection":
                    configManager.current.connSLClient = 3;
                    configManager.save();
                    break;
                case "loadUrlUpgradeKee":
                    pm({ loadUrlUpgradeKee: true });
                    break;
                case "disableNotifyWhenEntryUpdated":
                    configManager.current.notifyWhenEntryUpdated = false;
                    configManager.save();
                    break;
                case "launchLoginEditorFromNotification":
                    pm({
                        loginEditor: {
                            uuid: data.uuid,
                            DBfilename: data.fileName
                        }
                    } as AddonMessage);
                    break;
            }
            pm({ removeNotification: id } as AddonMessage);
        },
        closeNotification(id: string) {
            const pm = Port.postMessage;
            pm({ removeNotification: id } as AddonMessage);
        }
    }
};
</script>
