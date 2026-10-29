import { FormUtils } from "./formsUtils";
import { MatchResult } from "./MatchResult";
import { FilledField } from "./FilledField";
import { KeeLogger } from "../common/Logger";
import { configManager } from "../common/ConfigManager";
import type { AddonMessage } from "../common/AddonMessage";
import { Action } from "../common/Action";
import { submittedCredentials } from "../common/submittedLogin";
import { MatchedField } from "./MatchedField";
import { Field } from "../common/model/Field";
import punycode from "punycode/";

// Klick auf den Absende-Knopf und "submit" kurz danach gehören zu einem Versuch
const SAME_SUBMIT_MS = 1000;

interface SubmitHandlerAttachment {
    target: HTMLElement;
    handler: (e: Event) => void;
    form: HTMLFormElement;
}

export class FormSaving {
    private Logger: KeeLogger;
    private formUtils: FormUtils;
    private SubmitHandlerAttachments: SubmitHandlerAttachment[] = [];
    private matchResult: MatchResult; //TODO:5: May be overkill to have all this data available for saving
    // Letztes ausgewertetes Absenden: Klick auf den Absende-Knopf und das folgende "submit" sind derselbe Versuch
    private lastSubmit: { form: HTMLFormElement; at: number } = null;

    constructor(private myPort: chrome.runtime.Port, logger: KeeLogger, formUtils: FormUtils) {
        this.Logger = logger;
        this.formUtils = formUtils;
    }

    public addSubmitHandler(target: HTMLElement, formToSubmit: HTMLFormElement) {
        const handler = (e: Event) => this.submitHandler(e, formToSubmit);
        this.SubmitHandlerAttachments.push({
            target: target,
            form: formToSubmit,
            handler: handler
        });
        if (target) target.addEventListener("click", handler);
        formToSubmit.addEventListener("submit", handler);
    }

    public removeAllSubmitHandlers() {
        this.SubmitHandlerAttachments.forEach(attachment => {
            if (attachment.target) {
                attachment.target.removeEventListener("click", attachment.handler);
            }
            attachment.form.removeEventListener("submit", attachment.handler);
        });
        this.SubmitHandlerAttachments = [];
    }

    public updateMatchResult(matchResult: MatchResult) {
        this.matchResult = matchResult;
    }

    // This won't always be called before all event handlers on the web page so on
    // some sites we will store invalid data (in cases where the login scripts
    // mangle the contents of the fields before submitting them).
    //TODO:5: Possibly could slightly reduce incidence of this problem by listening
    // to every click on the document body or tracking all input events but performance?
    private submitHandler(_e: Event, form: HTMLFormElement) {
        this.Logger.debug("submitHandler called");

        // Derselbe Versuch löst Klick und "submit" aus: nur einmal auswerten. Die Handler bleiben aktiv, damit ein
        // weiterer Versuch auf derselben Seite (z. B. nach "Passwort falsch" ohne Neuladen) wieder erkannt wird
        const now = Date.now();
        if (this.lastSubmit?.form === form && now - this.lastSubmit.at < SAME_SUBMIT_MS) return;
        this.lastSubmit = { form, at: now };

        const doc = form.ownerDocument;
        const url = new URL(doc.URL);
        url.hostname = punycode.toUnicode(url.hostname);

        const conf = configManager.siteConfigFor(url.href);
        if (conf.preventSaveNotification) return;

        // Get the appropriate fields from the form.
        const passwordFields: MatchedField[] = [];
        let scanResult: {
            otherFields: MatchedField[];
            actualUsernameIndex?: number;
            pwFields?: MatchedField[];
        };
        try {
            scanResult = this.formUtils.getFormFields(form, true, 50);
        } catch (ex) {
            this.Logger.warn("Lost interest in this form after finding too many fields" + ex);
            return;
        }
        const usernameIndex = scanResult.actualUsernameIndex;
        const passwords = scanResult.pwFields;
        const otherFields = scanResult.otherFields;

        if (passwords.length > 1) {
            // could be password change form or multi-password login form or sign up form
            // naive duplicate finder - more than sufficient for the number of passwords per domain
            let twoPasswordsMatchIndex = -1;
            for (let i = 0; i < passwords.length && twoPasswordsMatchIndex == -1; i++) {
                for (let j = i + 1; j < passwords.length && twoPasswordsMatchIndex == -1; j++) {
                    if (passwords[j].field.value == passwords[i].field.value) {
                        twoPasswordsMatchIndex = j;
                    }
                }
            }

            if (twoPasswordsMatchIndex == -1) {
                // either mis-typed password change form, single password change box form or multi-password login/signup, assuming latter.
                this.Logger.debug("multiple passwords found (with no identical values)");

                for (let i = 0; i < passwords.length; i++) passwordFields.push(passwords[i]);

                //TODO:5: try to distinguish between multi-password login/signup and typo. maybe: if username exists and matches existing password it is a typo, else multi-password
                //return;
            } // it's probably a password change form, but may be a sign-up form
            else {
                // we need to ignore any fields that were presented to the
                // user as either "old password" or "retype new password"

                this.Logger.debug(
                    "Looks like a password change form or new registration form has been submitted"
                );
                // there may be more than one pair of matches - though, we're plucking for the first one
                // we know the index of one matching password

                // if there are only two passwords we already know that they match
                if (passwords.length == 2) {
                    // Passwort und Wiederholung (Registrierung oder neues Passwort ohne das alte)
                    passwordFields.push(passwords[0]);
                } else {
                    // Drei Felder: altes Passwort, neues Passwort und Wiederholung; das neue zählt
                    passwordFields.push(passwords[twoPasswordsMatchIndex]);
                }
            }
        } else if (passwords != null && passwords[0] != null && passwords[0] != undefined) {
            passwordFields.push(passwords[0]);
        }
        // at this point, at least one passwordField has been chosen

        const nonEmptyPasswordFields = this.removeEmptyFields(passwordFields);
        const nonEmptyOtherFields = this.removeEmptyFields(otherFields);

        // Find the first filled password that is not being submitted or has a changed value
        const differentPassword =
            !this.matchResult ||
            !this.matchResult.lastFilledPasswords ||
            this.hasFieldBeenModified(nonEmptyPasswordFields, this.matchResult.lastFilledPasswords);

        // Find the first filled other field that is not being submitted or has a changed value
        const differentOther =
            !this.matchResult ||
            !this.matchResult.lastFilledOther ||
            this.hasFieldBeenModified(nonEmptyOtherFields, this.matchResult.lastFilledOther);

        const fields = Field.combineDomFieldLists(
            usernameIndex,
            nonEmptyOtherFields.map(f => f.field),
            nonEmptyPasswordFields.map(f => f.field)
        );
        if (differentPassword || differentOther) {
            const submittedData = {
                url: url.href,
                fields,
                title: siteTitle(doc, url)
            };

            this.myPort.postMessage({ submittedData } as AddonMessage);
        } else {
            // Unverändert mit den eingetragenen Daten angemeldet: kein Speichern-Hinweis, aber ein noch offenes Angebot
            // desselben Benutzers (z. B. für ein vorher vertipptes Passwort) ist damit erledigt
            this.myPort.postMessage({
                action: Action.FilledLoginSubmitted,
                submittedUsername: submittedCredentials(fields).username
            } as AddonMessage);
        }
    }

    private removeEmptyFields(fields: MatchedField[]) {
        return fields.filter(f => f.field.value || f.field.type === "boolean");
    }

    private hasFieldBeenModified(
        newlySubmittedFields: MatchedField[],
        previouslyFilledFields: FilledField[]
    ) {
        return !!previouslyFilledFields.find(filledField => {
            const submittedField = newlySubmittedFields.find(
                f => filledField.DOMelement == f.DOMelement
            );

            // If we haven't submitted the same DOM element we filled in
            if (!submittedField) return true;

            if (submittedField.field.value != filledField.value) return true;

            return false;
        });
    }
}

// Titel für einen neuen Eintrag: der Name, den die Website selbst angibt (og:site_name, application-name),
// sonst der Hostname ohne "www." – der Seitentitel ("Register New Account - …") taugt dafür selten
function siteTitle(doc: Document, url: URL): string {
    const meta = (selector: string) => doc.querySelector<HTMLMetaElement>(selector)?.content?.trim();
    const name = meta('meta[property="og:site_name"]') || meta('meta[name="application-name"]');
    if (name && name.length <= 60) return name;
    return url.hostname.replace(/^www\./, "") || doc.title;
}
