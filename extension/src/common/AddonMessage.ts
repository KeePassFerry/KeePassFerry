import { Action } from "./Action";
import { FrameState } from "./FrameState";
import { KeeNotification } from "./KeeNotification";
import { PasswordProfile } from "./model/PasswordProfile";
import type { SubmittedData } from "./SubmittedData";
import type { KeeState } from "../store/KeeState";
import { Entry } from "./model/Entry";
import { Mutation } from "../store/Mutation";

// Do not use classes on this interface unless they are simple data
// objects that can be represented in JSON. This interface is used
// by the browser cross-process communication layer which we have
// no control over and thus we can only avoid bugs by ensuring that
// this rule is followed. In cases where a class with additional
// functionality is required, manually new up each object as and
// when required or use static methods instead.

export interface AddonMessage {
    frameState?: FrameState;
    isForegroundTab?: boolean;
    tabId?: number;
    frameId?: number;
    loadUrlUpgradeKee?: boolean;
    addNotification?: KeeNotification;
    removeNotification?: string;
    findMatches?: { uri?: string; uuid?: string; DBfilename?: string };
    findMatchesResult?: Entry[];
    entries?: Entry[];
    action?: Action;
    selectedEntryIndex?: number;
    passwordProfiles?: PasswordProfile[];
    generatedPassword?: string;
    passwordProfile?: string;
    submittedData?: SubmittedData;
    loginEditor?: { uuid: string; DBfilename: string };
    loginsFound?: boolean;
    initialState?: KeeState;
    resetState?: KeeState;
    mutation?: Mutation;
    url?: string;
    copyToClipboard?: string;
    otpCode?: string;
    otpRemaining?: number;
    // Anfrage durch bewusste Nutzeraktion (z. B. Klick aufs Symbol): darf sofort entsperren
    userInitiated?: boolean;
    // Seite: Klick auf ein gesperrtes Feldsymbol -> entsperren
    requestUnlock?: boolean;
    ferryDiag?: { event: string; data?: Record<string, unknown> };
    otpPeriod?: number;
    preferredUuid?: string;
    otpIssuer?: string;
    unlocked?: boolean;
    webauthn?: any;
    otpSetup?: {
        otpUri?: string;
        otpSecret?: string;
        otpQrRects?: { x: number; y: number; w: number; h: number }[];
        otpQrImages?: string[];
        viewportWidth?: number;
    };
    filledEntry?: { uuid: string; dbFileName: string };
    // Popup: welche Feldarten die Seite hat, und einzelnes Feld aus dem Popup füllen
    queryId?: number;
    fieldsAvailable?: PageFieldKinds;
    fillKind?: PageFieldKind;
    fillValue?: string;
}

export type PageFieldKind = "username" | "password" | "otp";
export type PageFieldKinds = Record<PageFieldKind, boolean>;
