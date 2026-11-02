import { SiteConfig } from "../common/config";
import { FerryLog } from "../common/Logger";
import { configManager } from "../common/ConfigManager";
import {setup as i18nSetup } from "../common/i18n";

// Einstellungen für alle Websites (Knoten "^.*$"); eigene Einstellungen je Website gibt es nicht mehr in der Oberfläche
function globalSiteConfig(): SiteConfig {
    return configManager.current.siteConfig.pageRegex["^.*$"].config;
}

async function setupPage() {
    await configManager.load();
    FerryLog.attachConfig(configManager.current);
    loadInitialConfig();
    [].forEach.call(
        $$(".siteSpecificToggle"),
        node => ((node as HTMLElement).style.display = "none")
    );
    setupInputListeners();
    document.getElementById("i18n_root").style.display = "block";
}

function loadInitialConfig() {
    (document.getElementById("pref_searchAllOpenDBs_label") as HTMLInputElement).checked =
        configManager.current.searchAllOpenDBs ? configManager.current.searchAllOpenDBs : null;

    (
        document.getElementById("pref_autoFillFormsWithMultipleMatches_label") as HTMLInputElement
    ).checked = configManager.current.autoFillFormsWithMultipleMatches
        ? configManager.current.autoFillFormsWithMultipleMatches
        : null;

    (
        document.getElementById("pref_autoFillFieldsWithExistingValue_label") as HTMLInputElement
    ).checked = configManager.current.autoFillFieldsWithExistingValue
        ? configManager.current.autoFillFieldsWithExistingValue
        : null;

    (
        document.getElementById("pref_manualFillSubmitOverridable_label") as HTMLInputElement
    ).checked = configManager.current.manualSubmitOverrideProhibited ? null : true;
    (document.getElementById("pref_when_one_matching_network_login") as HTMLInputElement).checked =
        configManager.current.autoSubmitNetworkAuthWithSingleMatch
            ? configManager.current.autoSubmitNetworkAuthWithSingleMatch
            : null;

    (document.getElementById("pref_saveFavicons_label") as HTMLInputElement).checked = configManager
        .current.saveFavicons
        ? configManager.current.saveFavicons
        : null;
    (document.getElementById("pref_rememberMRUGroup_label") as HTMLInputElement).checked =
        configManager.current.rememberMRUGroup ? configManager.current.rememberMRUGroup : null;
    (document.getElementById("pref_showConfirmationAfterSave_label") as HTMLInputElement).checked =
        !configManager.current.hideConfirmationAfterSave ? true : null;

    (
        document.getElementById("pref_standard_form_choice_desc") as HTMLSelectElement
    ).value = configManager.current.autoSubmitForms
        ? "FillAndSubmit"
        : configManager.current.autoFillForms
        ? "Fill"
        : "DoNothing";
    (document.getElementById("pref_when_user_chooses_desc") as HTMLSelectElement).value =
        configManager.current.autoSubmitMatchedForms ? "FillAndSubmit" : "Fill";
    (document.getElementById("pref_theme_desc") as HTMLSelectElement).value = stringFromTheme(
        configManager.current.theme
    );

    (document.getElementById("pref_currentSearchTermTimeout_label") as HTMLInputElement).value =
        configManager.current.currentSearchTermTimeout
            ? configManager.current.currentSearchTermTimeout.toString()
            : "";

    setSiteSpecificConfigValues();
}

function setupInputListeners() {
    document
        .getElementById("pref_searchAllOpenDBs_label")
        .addEventListener("change", saveSearchAllOpenDBs);
    document
        .getElementById("pref_autoFillFormsWithMultipleMatches_label")
        .addEventListener("change", saveAutoFillFormsWithMultipleMatches);
    document
        .getElementById("pref_autoFillFieldsWithExistingValue_label")
        .addEventListener("change", saveAutoFillFieldsWithExistingValue);
    document
        .getElementById("pref_manualFillSubmitOverridable_label")
        .addEventListener("change", saveManualSubmitOverrideProhibited);
    document
        .getElementById("pref_when_one_matching_network_login")
        .addEventListener("change", saveAutoSubmitNetworkAuthWithSingleMatch);

    document
        .getElementById("pref_notifyBarRequestPasswordSave_label")
        .addEventListener("change", saveOfferToSavePasswords);


    document.getElementById("pref_saveFavicons_label").addEventListener("change", saveSaveFavicons);
    document
        .getElementById("pref_rememberMRUGroup_label")
        .addEventListener("change", saveRememberMRUGroup);
    document
        .getElementById("pref_showConfirmationAfterSave_label")
        .addEventListener("change", saveShowConfirmationAfterSaveUpdated);

    document
        .getElementById("pref_standard_form_choice_desc")
        .addEventListener("change", saveStandardFormChoice);
    document
        .getElementById("pref_when_user_chooses_desc")
        .addEventListener("change", saveWhenUserChooses);

    document
        .getElementById("pref_currentSearchTermTimeout_label")
        .addEventListener("change", saveCurrentSearchTermTimeout);

    for (const node of $$(".formFindingControlGroup")) {
        (node as HTMLElement).firstElementChild.firstElementChild.addEventListener(
            "change",
            formFindingControlGroupChange
        );
        (node as HTMLElement).firstElementChild.nextElementSibling.addEventListener(
            "change",
            changeSiteConfigFormFindingItem
        );
    }

    document.getElementById("pref_theme_desc").addEventListener("change", saveTheme);
}

function formFindingControlGroupChange(e: Event) {
    const targetCheckbox = e.target as HTMLInputElement;
    const targetInput = targetCheckbox.parentElement.nextElementSibling as HTMLInputElement;
    targetInput.disabled = !targetCheckbox.checked;

    if (targetCheckbox.checked) return changeSiteConfigFormFindingItem(null, targetInput);

    const siteConfig = globalSiteConfig();

    switch (targetInput.id) {
        case "sssWhiteFormName":
            if (
                siteConfig.whiteList &&
                siteConfig.whiteList.form &&
                siteConfig.whiteList.form.names
            ) {
                delete siteConfig.whiteList.form.names;
                if (!siteConfig.whiteList.form.ids) {
                    delete siteConfig.whiteList.form;
                    if (!siteConfig.whiteList.fields && !siteConfig.whiteList.querySelectors) {
                        delete siteConfig.whiteList;
                    }
                }
            }
            break;
        case "sssWhiteFormId":
            if (
                siteConfig.whiteList &&
                siteConfig.whiteList.form &&
                siteConfig.whiteList.form.ids
            ) {
                delete siteConfig.whiteList.form.ids;
                if (!siteConfig.whiteList.form.names) {
                    delete siteConfig.whiteList.form;
                    if (!siteConfig.whiteList.fields && !siteConfig.whiteList.querySelectors) {
                        delete siteConfig.whiteList;
                    }
                }
            }
            break;
        case "sssWhiteFieldName":
            if (
                siteConfig.whiteList &&
                siteConfig.whiteList.fields &&
                siteConfig.whiteList.fields.names
            ) {
                delete siteConfig.whiteList.fields.names;
                if (!siteConfig.whiteList.fields.ids) {
                    delete siteConfig.whiteList.fields;
                    if (!siteConfig.whiteList.fields && !siteConfig.whiteList.querySelectors) {
                        delete siteConfig.whiteList;
                    }
                }
            }
            break;
        case "sssWhiteFieldId":
            if (
                siteConfig.whiteList &&
                siteConfig.whiteList.fields &&
                siteConfig.whiteList.fields.ids
            ) {
                delete siteConfig.whiteList.fields.ids;
                if (!siteConfig.whiteList.fields.names) {
                    delete siteConfig.whiteList.fields;
                    if (!siteConfig.whiteList.fields && !siteConfig.whiteList.querySelectors) {
                        delete siteConfig.whiteList;
                    }
                }
            }
            break;
        case "sssBlackFormName":
            if (
                siteConfig.blackList &&
                siteConfig.blackList.form &&
                siteConfig.blackList.form.names
            ) {
                delete siteConfig.blackList.form.names;
                if (!siteConfig.blackList.form.ids) {
                    delete siteConfig.blackList.form;
                    if (!siteConfig.blackList.fields && !siteConfig.blackList.querySelectors) {
                        delete siteConfig.blackList;
                    }
                }
            }
            break;
        case "sssBlackFormId":
            if (
                siteConfig.blackList &&
                siteConfig.blackList.form &&
                siteConfig.blackList.form.ids
            ) {
                delete siteConfig.blackList.form.ids;
                if (!siteConfig.blackList.form.names) {
                    delete siteConfig.blackList.form;
                    if (!siteConfig.blackList.fields && !siteConfig.blackList.querySelectors) {
                        delete siteConfig.blackList;
                    }
                }
            }
            break;
        case "sssBlackFieldName":
            if (
                siteConfig.blackList &&
                siteConfig.blackList.fields &&
                siteConfig.blackList.fields.names
            ) {
                delete siteConfig.blackList.fields.names;
                if (!siteConfig.blackList.fields.ids) {
                    delete siteConfig.blackList.fields;
                    if (!siteConfig.blackList.fields && !siteConfig.blackList.querySelectors) {
                        delete siteConfig.blackList;
                    }
                }
            }
            break;
        case "sssBlackFieldId":
            if (
                siteConfig.blackList &&
                siteConfig.blackList.fields &&
                siteConfig.blackList.fields.ids
            ) {
                delete siteConfig.blackList.fields.ids;
                if (!siteConfig.blackList.fields.names) {
                    delete siteConfig.blackList.fields;
                    if (!siteConfig.blackList.fields && !siteConfig.blackList.querySelectors) {
                        delete siteConfig.blackList;
                    }
                }
            }
            break;
    }

    configManager.save();
}

function changeSiteConfigFormFindingItem(e: Event, targetInput?: HTMLInputElement) {
    if (!targetInput) targetInput = e.target as HTMLInputElement;
    const values = targetInput.value ? targetInput.value.split(",") : [];
    const siteConfig = globalSiteConfig();

    switch (targetInput.id) {
        case "sssWhiteFormName":
            if (!siteConfig.whiteList) siteConfig.whiteList = {};
            if (!siteConfig.whiteList.form) siteConfig.whiteList.form = {};
            siteConfig.whiteList.form.names = values.filter(v => v.length > 0);
            break;
        case "sssWhiteFormId":
            if (!siteConfig.whiteList) siteConfig.whiteList = {};
            if (!siteConfig.whiteList.form) siteConfig.whiteList.form = {};
            siteConfig.whiteList.form.ids = values.filter(v => v.length > 0);
            break;
        case "sssWhiteFieldName":
            if (!siteConfig.whiteList) siteConfig.whiteList = {};
            if (!siteConfig.whiteList.fields) siteConfig.whiteList.fields = {};
            siteConfig.whiteList.fields.names = values.filter(v => v.length > 0);
            break;
        case "sssWhiteFieldId":
            if (!siteConfig.whiteList) siteConfig.whiteList = {};
            if (!siteConfig.whiteList.fields) siteConfig.whiteList.fields = {};
            siteConfig.whiteList.fields.ids = values.filter(v => v.length > 0);
            break;
        case "sssBlackFormName":
            if (!siteConfig.blackList) siteConfig.blackList = {};
            if (!siteConfig.blackList.form) siteConfig.blackList.form = {};
            siteConfig.blackList.form.names = values.filter(v => v.length > 0);
            break;
        case "sssBlackFormId":
            if (!siteConfig.blackList) siteConfig.blackList = {};
            if (!siteConfig.blackList.form) siteConfig.blackList.form = {};
            siteConfig.blackList.form.ids = values.filter(v => v.length > 0);
            break;
        case "sssBlackFieldName":
            if (!siteConfig.blackList) siteConfig.blackList = {};
            if (!siteConfig.blackList.fields) siteConfig.blackList.fields = {};
            siteConfig.blackList.fields.names = values.filter(v => v.length > 0);
            break;
        case "sssBlackFieldId":
            if (!siteConfig.blackList) siteConfig.blackList = {};
            if (!siteConfig.blackList.fields) siteConfig.blackList.fields = {};
            siteConfig.blackList.fields.ids = values.filter(v => v.length > 0);
            break;
    }

    configManager.save();
}

function setupFormFindingSetting(id: string, enabled: boolean, values: string[]) {
    const inputBox = document.getElementById(id) as HTMLInputElement;
    const enablingCheckbox = inputBox.parentElement.firstElementChild
        .firstElementChild as HTMLInputElement;
    inputBox.value = values.join();
    inputBox.disabled = enabled ? null : true;
    enablingCheckbox.checked = enabled ? true : null;
}

function setSiteSpecificConfigValues() {
    const siteConfig = globalSiteConfig();
    (document.getElementById("pref_notifyBarRequestPasswordSave_label") as HTMLInputElement).checked =
        siteConfig.preventSaveNotification === true ? null : true;

    let enabled: boolean;

    enabled =
        siteConfig.whiteList && siteConfig.whiteList.form && siteConfig.whiteList.form.names
            ? true
            : false;
    setupFormFindingSetting(
        "sssWhiteFormName",
        enabled,
        enabled ? siteConfig.whiteList.form.names : []
    );
    enabled =
        siteConfig.whiteList && siteConfig.whiteList.form && siteConfig.whiteList.form.ids
            ? true
            : false;
    setupFormFindingSetting(
        "sssWhiteFormId",
        enabled,
        enabled ? siteConfig.whiteList.form.ids : []
    );
    enabled =
        siteConfig.whiteList && siteConfig.whiteList.fields && siteConfig.whiteList.fields.names
            ? true
            : false;
    setupFormFindingSetting(
        "sssWhiteFieldName",
        enabled,
        enabled ? siteConfig.whiteList.fields.names : []
    );
    enabled =
        siteConfig.whiteList && siteConfig.whiteList.fields && siteConfig.whiteList.fields.ids
            ? true
            : false;
    setupFormFindingSetting(
        "sssWhiteFieldId",
        enabled,
        enabled ? siteConfig.whiteList.fields.ids : []
    );

    enabled =
        siteConfig.blackList && siteConfig.blackList.form && siteConfig.blackList.form.names
            ? true
            : false;
    setupFormFindingSetting(
        "sssBlackFormName",
        enabled,
        enabled ? siteConfig.blackList.form.names : []
    );
    enabled =
        siteConfig.blackList && siteConfig.blackList.form && siteConfig.blackList.form.ids
            ? true
            : false;
    setupFormFindingSetting(
        "sssBlackFormId",
        enabled,
        enabled ? siteConfig.blackList.form.ids : []
    );
    enabled =
        siteConfig.blackList && siteConfig.blackList.fields && siteConfig.blackList.fields.names
            ? true
            : false;
    setupFormFindingSetting(
        "sssBlackFieldName",
        enabled,
        enabled ? siteConfig.blackList.fields.names : []
    );
    enabled =
        siteConfig.blackList && siteConfig.blackList.fields && siteConfig.blackList.fields.ids
            ? true
            : false;
    setupFormFindingSetting(
        "sssBlackFieldId",
        enabled,
        enabled ? siteConfig.blackList.fields.ids : []
    );
}

function saveSearchAllOpenDBs(e) {
    e.preventDefault();
    configManager.setASAP({
        searchAllOpenDBs: (
            document.getElementById("pref_searchAllOpenDBs_label") as HTMLInputElement
        ).checked
    });
}

function saveAutoFillFormsWithMultipleMatches(e) {
    e.preventDefault();
    configManager.setASAP({
        autoFillFormsWithMultipleMatches: (
            document.getElementById(
                "pref_autoFillFormsWithMultipleMatches_label"
            ) as HTMLInputElement
        ).checked
    });
}

function saveAutoFillFieldsWithExistingValue(e) {
    e.preventDefault();
    configManager.setASAP({
        autoFillFieldsWithExistingValue: (
            document.getElementById(
                "pref_autoFillFieldsWithExistingValue_label"
            ) as HTMLInputElement
        ).checked
    });
}

function saveManualSubmitOverrideProhibited(e) {
    e.preventDefault();
    configManager.setASAP({
        manualSubmitOverrideProhibited: !(
            document.getElementById("pref_manualFillSubmitOverridable_label") as HTMLInputElement
        ).checked
    });
}

function saveAutoSubmitNetworkAuthWithSingleMatch(e) {
    e.preventDefault();
    configManager.setASAP({
        autoSubmitNetworkAuthWithSingleMatch: (
            document.getElementById("pref_when_one_matching_network_login") as HTMLInputElement
        ).checked
    });
}

function saveOfferToSavePasswords(e) {
    e.preventDefault();

    const save = (document.getElementById("pref_notifyBarRequestPasswordSave_label") as HTMLInputElement)
        .checked;
    globalSiteConfig().preventSaveNotification = !save;
    configManager.save();
}

function saveSaveFavicons(e) {
    e.preventDefault();
    configManager.setASAP({
        saveFavicons: (document.getElementById("pref_saveFavicons_label") as HTMLInputElement)
            .checked
    });
}

function saveRememberMRUGroup(e) {
    e.preventDefault();
    configManager.setASAP({
        rememberMRUGroup: (
            document.getElementById("pref_rememberMRUGroup_label") as HTMLInputElement
        ).checked
    });
}

function saveShowConfirmationAfterSaveUpdated(e) {
    e.preventDefault();
    configManager.setASAP({
        hideConfirmationAfterSave: !(
            document.getElementById("pref_showConfirmationAfterSave_label") as HTMLInputElement
        ).checked
    });
}

function saveStandardFormChoice(e) {
    e.preventDefault();
    const selectedValue = (
        document.getElementById("pref_standard_form_choice_desc") as HTMLSelectElement
    ).value;
    configManager.setASAP({ autoFillForms: selectedValue != "DoNothing" });
    configManager.setASAP({
        autoSubmitForms: selectedValue == "FillAndSubmit"
    });
}

function saveWhenUserChooses(e) {
    e.preventDefault();
    const selectedValue = (
        document.getElementById("pref_when_user_chooses_desc") as HTMLSelectElement
    ).value;
    configManager.setASAP({
        autoSubmitMatchedForms: selectedValue == "FillAndSubmit"
    });
}

function saveTheme(e) {
    e.preventDefault();
    const selectedValue = (document.getElementById("pref_theme_desc") as HTMLSelectElement).value;
    configManager.setASAP({ theme: themeFromString(selectedValue) });
}

function saveCurrentSearchTermTimeout(e) {
    e.preventDefault();
    configManager.setASAP({
        currentSearchTermTimeout: parseInt(
            (document.getElementById("pref_currentSearchTermTimeout_label") as HTMLInputElement)
                .value
        )
    });
}

function themeFromString(theme) {
    if (!theme) return null;
    return theme;
}

function stringFromTheme(theme) {
    if (!theme) return "";
    return theme;
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", async () => await setupPage());
} else {
    (async () => {
        await setupPage();
    })();
}

i18nSetup();
