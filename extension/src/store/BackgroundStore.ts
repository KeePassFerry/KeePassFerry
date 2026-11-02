import { Mutation } from "./Mutation";
import { FerryLog } from "~/common/Logger";
import NonReactiveStore from "./NonReactiveStore";

export default class BackgroundStore extends NonReactiveStore {

    onRemoteMessage(sourcePort: chrome.runtime.Port, mutation: Mutation) {
        super.onRemoteMessage(sourcePort, mutation);

        FerryLog.debug("BackgroundStore.onRemoteMessage distributing");
        this.distributeAction(mutation, sourcePort);
    }

};
