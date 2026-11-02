export type SiteConfigMethod = "Exact" | "Prefix" | "Regex";
export type SiteConfigTarget = "Domain" | "Host" | "Page";
export type SiteConfigNodeType = "Migration" | "User" | "Default" | "Auto";

export class FormMatchConfig {
    form?: {
        names?: string[];
        ids?: string[];
    };
    fields?: {
        names?: string[];
        ids?: string[];
    };
    querySelectors?: string[];
}

export class SiteConfig {
    whiteList?: FormMatchConfig;
    blackList?: FormMatchConfig;
    preventSaveNotification?: boolean;
    listMatchingCaseSensitive?: boolean;
    preferredEntryUuid?: string;
}

export class SiteConfigNode {
    config: SiteConfig;
    matchWeight: number; // help to decide which config to use when more than one matches current URL
    source: SiteConfigNodeType;
}

export class SiteConfigLookup {
    [key: string]: SiteConfigNode;
}

export class SiteConfigIndex {
    domainRegex?: SiteConfigLookup;
    domainExact?: SiteConfigLookup;
    domainPrefix?: SiteConfigLookup;
    hostRegex?: SiteConfigLookup;
    hostExact?: SiteConfigLookup;
    hostPrefix?: SiteConfigLookup;
    pageRegex?: SiteConfigLookup;
    pageExact?: SiteConfigLookup;
    pagePrefix: SiteConfigLookup;
}

export class Config {
    autoFillDialogs: boolean;
    autoFillForms: boolean;
    autoFillFormsWithMultipleMatches: boolean;
    autoSubmitForms: boolean;
    autoSubmitDialogs: boolean;
    autoSubmitMatchedForms: boolean;
    keePassDBToOpen: string;
    keePassMRUDB: string;
    lastConnectedToKeePass: string;
    listAllOpenDBs: boolean;
    logLevel: number;
    logMethodConsole: boolean;
    logMethodFile: boolean;
    logSensitiveData: boolean;
    metricsUsageDisabled: boolean;
    metricsUserId: string;
    mruGroup: { [key: string]: string };
    notifyWhenEntryUpdated: boolean;
    notifyWhenLateDiscovery: boolean;
    notifyWhenLoggedOut: boolean;
    overWriteFieldsAutomatically: boolean; // deprecated
    rememberMRUDB: boolean;
    rememberMRUGroup: boolean;
    saveFavicons: boolean;
    searchAllOpenDBs: boolean;
    siteConfig: SiteConfigIndex;
    config: { url: string; config: Record<string, unknown> }[];
    tutorialProgress: string;
    version: number; // default is incremented when changes are introduced that require data migration
    triggerChangeInputEventAfterFill: boolean;
    autoSubmitNetworkAuthWithSingleMatch: boolean;
    searchNetworkAuth: boolean;
    portConnectionDelay: number; // deprecated
    notificationCountGeneric: number;
    notificationCountSavePassword: number;
    currentSearchTermTimeout: number;
    notifyPasswordAvailableForPaste: boolean;
    animateWhenOfferingSave: boolean;
    manualSubmitOverrideProhibited: boolean;
    theme: string;
    hideConfirmationAfterSave: boolean;
    mustShowReleaseNotesAtStartup: boolean;
    autoFillFieldsWithExistingValue: boolean;
    // KeePassFerry: Diagnoseprotokoll (Ereignisse ohne Inhalte) über das Plugin in eine Datei schreiben
    ferryDiagnostics: boolean;
    // KeePassFerry-Funktionen (Einstellungen > KeePassFerry)
    ferryAutoFillOtp: boolean;
    ferryDetectOtpSetup: boolean;
    ferryPasskeys: boolean;
    ferryShowFieldIcons: boolean;
    // Einträge mit Ablaufdatum (KeePass "Gültig bis"): Vorwarnung so viele Tage vorher (0 = keine). Ob abgelaufene
    // ausgeblendet werden oder an einen Wechsel erinnert wird, steht im Plugin (Get/SetHideExpired)
    ferryExpiryWarnDays: number;
    ferryDisableBrowserPasswordSaving: boolean;
    // Anmeldefenster des Browsers (HTTP-Basic-Auth, Proxy) ausfüllen; aus Sicherheitsgründen nur auf Wunsch
    ferryNetworkAuth: boolean;
}
