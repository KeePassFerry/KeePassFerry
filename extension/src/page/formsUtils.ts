import { isOtpField } from "./OtpFields";
import { isUsernameField } from "./loginFields";
import { KeeLogger } from "../common/Logger";
import { MatchedField } from "./MatchedField";
import { Field } from "../common/model/Field";
import { findInputsInOpenShadowRoots } from "./shadowDom";

/*
  This contains code related to the management and manipulation of forms and form fields.
*/

export class FormUtils {
    findLoginOps = [];
    matchResults = [];
    Logger: KeeLogger;

    constructor(logger: KeeLogger) {
        this.Logger = logger;
    }

    countAllDocuments(frame: Window) {
        if (!this.isUriWeCanFill(frame.location)) return 0;

        let localDocCount = 1;

        if (frame.frames.length > 0) {
            const frames = frame.frames;
            for (let i = 0; i < frames.length; i++) {
                localDocCount += this.countAllDocuments(frames[i]);
            }
        }
        return localDocCount;
    }

    isUriWeCanFill(uri) {
        if (uri.protocol == "http:" || uri.protocol == "https:" || uri.protocol == "file:") {
            return true;
        }
        return false;
    }

    isATextFormFieldType(type) {
        if (
            type == "checkbox" ||
            type == "select-one" ||
            type == "radio" ||
            type == "password" ||
            type == "hidden" ||
            type == "submit" ||
            type == "button" ||
            type == "file" ||
            type == "image" ||
            type == "reset"
        ) {
            return false;
        } else return true;
    }

    /*
     * getFormFields
     *
     * Returns the usernameIndex and password fields found in the form.
     * Can handle complex forms by trying to figure out what the
     * relevant fields are.
     *
     * Returns: [usernameIndex, passwords, ...]
     * all arrays are standard javascript arrays
     * usernameField may be null.
     */
    public getFormFields(form, isSubmission: boolean, maximumFieldCount: number) {
        const pwFields: MatchedField[] = [];
        const otherFields: MatchedField[] = [];
        const allFields: {
            index: number;
            element: MatchedField;
            type: string;
        }[] = [];
        let firstPasswordIndex = -1;
        let usernameIndex = -1;

        // search the DOM for any form fields we might be interested in
        // Pseudo forms are not DOM nodes and already include any fields from shadow roots
        const elements =
            form.nodeType === Node.ELEMENT_NODE
                ? [...Array.from(form.elements), ...findInputsInOpenShadowRoots(form)]
                : form.elements;
        const totalElements = elements.length;
        const elementLimit = totalElements < 2000 ? totalElements : 2000;
        for (let i = 0; i < elementLimit; i++) {
            if (allFields.length > maximumFieldCount) {
                throw new Error("Too many fields");
            }
            if (
                elements[i].localName.toLowerCase() == "object" ||
                elements[i].localName.toLowerCase() == "keygen" ||
                elements[i].localName.toLowerCase() == "output" ||
                (elements[i].localName.toLowerCase() != "input" &&
                    (elements[i].type == undefined || elements[i].type == null))
            ) {
                continue; // maybe it's something un-interesting
            }

            const domType: string = elements[i].type.toLowerCase();

            if (domType == "fieldset") continue; // not interested in fieldsets

            if (
                domType != "password" &&
                !this.isATextFormFieldType(domType) &&
                domType != "checkbox" &&
                domType != "radio" &&
                domType != "select-one"
            ) {
                continue; // ignoring other form types
            }

            if (domType != "password" && isOtpField(elements[i])) continue;

            if (domType == "radio" && isSubmission && elements[i].checked == false) continue;
            if (domType == "password" && isSubmission && !elements[i].value) continue;
            if (domType == "select-one" && isSubmission && !elements[i].value) continue;

            this.Logger.debug(`processing field with domtype ${domType}...`);
            allFields[allFields.length] = {
                index: i,
                element: new MatchedField(),
                type: domType
            };
            let fieldValue = elements[i].value;
            if (domType == "checkbox") {
                if (elements[i].checked) fieldValue = "KEEFOX_CHECKED_FLAG_TRUE";
                else fieldValue = "KEEFOX_CHECKED_FLAG_FALSE";
            }
            const field = Field.fromDOM(elements[i], domType, fieldValue);
            allFields[allFields.length - 1].element.field = field;
            allFields[allFields.length - 1].element.DOMelement = elements[i];

            if (domType == "password" && firstPasswordIndex == -1) {
                firstPasswordIndex = allFields.length - 1;
            }

            if (elements[i].keeInitialDetectedValue == null) {
                elements[i].keeInitialDetectedValue = fieldValue;
            }
        }

        // Benutzerfeld nach derselben Regel wie beim Ausfüllen (loginFields.ts: autocomplete, letztes Textfeld vor dem
        // Passwort, einzelnes Login-Feld); ohne Treffer (z. B. Benutzername nur versteckt mitgeschickt) das Textfeld
        // direkt vor dem ersten Passwortfeld
        usernameIndex = allFields.findIndex(
            f => this.isATextFormFieldType(f.type) && isUsernameField(f.element.DOMelement as HTMLInputElement)
        );
        if (usernameIndex == -1 && firstPasswordIndex > 0 && this.isATextFormFieldType(allFields[firstPasswordIndex - 1].type)) {
            usernameIndex = firstPasswordIndex - 1;
        }
        this.Logger.debug("usernameIndex: " + usernameIndex);

        let otherCount = 0;
        let actualUsernameIndex = 0;

        // separate the field data into appropriate variables
        for (let i = 0; i < allFields.length; i++) {
            if (allFields[i].type == "password") pwFields[pwFields.length] = allFields[i].element;
            else if (
                this.isATextFormFieldType(allFields[i].type) ||
                allFields[i].type == "checkbox" ||
                allFields[i].type == "radio" ||
                allFields[i].type == "select-one"
            ) {
                otherFields[otherFields.length] = allFields[i].element;
                if (i == usernameIndex) actualUsernameIndex = otherCount;
                else otherCount++;
            }
        }

        this.Logger.debug("actualUsernameIndex: " + actualUsernameIndex);
        this.Logger.debug("otherFields.length:" + otherFields.length);

        return {
            actualUsernameIndex,
            pwFields,
            otherFields
        };
    }

    // A basic, slightly flawed but fast visibility test
    public isDOMElementVisible(element: HTMLElement) {
        if (!element.offsetParent && element.offsetHeight === 0 && element.offsetWidth === 0) {
            return false;
        }
        return true;
    }

    // // used for multipage stuff that we might not be able to support yet in webextensions
    // resetFormFillSession () {
    //     if (resetFormFillTimer != null) {
    //         clearTimeout(resetFormFillTimer);
    //         resetFormFillTimer = null;
    //     }
    //     tabState.currentPage = 0;
    //     tabState.maximumPage = 0;
    //     tabState.forceAutoSubmit = null;
    //     tabState.userRecentlyDemandedAutoSubmit = false;
    //     Logger.debug("Reset form-filling session (page = 0 and cancelled any forced autosubmit).");
    // };
    //var resetFormFillTimer = null;
}
