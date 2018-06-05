// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/
import * as sarif from "sarif";
import { Command } from "vscode";
import { ExplorerContentProvider } from "./ExplorerContentProvider";
import { CodeFlow, CodeFlowStep, ThreadFlow } from "./Interfaces";
import { Location } from "./Location";
import { Utilities } from "./Utilities";

/**
 * Class that has the functions for processing the Sarif result codeflows
 */
export class CodeFlows {

    /**
     * Processes the array of Sarif codeflow objects
     * @param sarifCodeFlows array of Sarif codeflow objects to be processed
     */
    public static async create(sarifCodeFlows: sarif.CodeFlow[]): Promise<CodeFlow[]> {
        let codeFlows;
        if (sarifCodeFlows !== undefined && sarifCodeFlows.length !== 0) {
            codeFlows = [];
            for (let cFIndex = 0; cFIndex < sarifCodeFlows.length; cFIndex++) {
                await CodeFlows.createCodeFlow(sarifCodeFlows[cFIndex], `${cFIndex}`).then((codeFlow: CodeFlow) => {
                    codeFlows.push(codeFlow);
                });
            }
        }

        return Promise.resolve(codeFlows);
    }

    /**
     * Tries to remap any of the not mapped codeflow objects in the array of processed codeflow objects
     * @param codeFlows array of processed codeflow objects to try to remap
     * @param sarifCodeFlows Used if a codeflow needs to be remapped
     */
    public static async tryRemapCodeFlows(codeFlows: CodeFlow[], sarifCodeFlows: sarif.CodeFlow[]): Promise<void> {
        for (const cFKey of codeFlows.keys()) {
            const codeFlow = codeFlows[cFKey];
            for (const tFKey of codeFlow.threads.keys()) {
                const thread = codeFlow.threads[tFKey];
                for (const stepKey of thread.steps.keys()) {
                    const step = thread.steps[stepKey];
                    if (step.location !== null && step.location.mapped !== true) {
                        const sarifLoc = sarifCodeFlows[cFKey].threadFlows[tFKey].locations[stepKey].location;
                        await Location.create(sarifLoc.physicalLocation).then((location: Location) => {
                            codeFlows[cFKey].threads[tFKey].steps[stepKey].location = location;
                        });
                    }
                }
            }
        }
    }

    /**
     * Creates the CodeFlow object from the passed in sarif codeflow object
     * @param sarifCF the sarif codeflow object to be processed
     * @param traversalId The id based on the index in the codeflow array
     */
    private static async createCodeFlow(sarifCF: sarif.CodeFlow, traversalId: string): Promise<CodeFlow> {
        const codeFlow: CodeFlow = {
            message: undefined,
            threads: [],
        };

        if (sarifCF.message !== undefined) {
            codeFlow.message = Utilities.parseSarifMessage(sarifCF.message).text;
        }
        for (let tFIndex = 0; tFIndex < sarifCF.threadFlows.length; tFIndex++) {
            await CodeFlows.createThreadFlow(sarifCF.threadFlows[tFIndex], `${traversalId}_${tFIndex}`).then(
                (threadFlow: ThreadFlow) => {
                    codeFlow.threads.push(threadFlow);
                });
        }

        return Promise.resolve(codeFlow);
    }

    /**
     * Creates the ThreadFlow object from the passed in sarif threadflow object
     * @param sarifTF the sarif threadflow object to be processed
     * @param traversalId The id based on the index in the codeflow array and threadflow array(ex: "1_1")
     */
    private static async createThreadFlow(sarifTF: sarif.ThreadFlow, traversalId: string): Promise<ThreadFlow> {
        const threadFlow: ThreadFlow = {
            id: sarifTF.id,
            message: undefined,
            steps: [],
        };

        if (sarifTF.message !== undefined) {
            threadFlow.message = Utilities.parseSarifMessage(sarifTF.message).text;
        }

        for (let stepIndex = 0; stepIndex < sarifTF.locations.length; stepIndex++) {
            await CodeFlows.createCodeFlowStep(sarifTF.locations[stepIndex], sarifTF.locations[stepIndex + 1],
                `${traversalId}_${stepIndex}`).then((step: CodeFlowStep) => {
                    threadFlow.steps.push(step);
                });
        }

        return Promise.resolve(threadFlow);
    }

    /**
     * Creates the CodeFlowStep object from the passed in sarif CodeFlowLocation object
     * @param cFLoc the CodeFlowLocation object that needs to be processed
     * @param nextCFLoc the next CodeFlowLocation object, it's nesting level is used to determine if isCall or isReturn
     * @param traversalPathId The id based on the index in the codeflow, threadflow and locations arrays (ex: "0_2_1")
     */
    private static async createCodeFlowStep(
        cFLoc: sarif.CodeFlowLocation,
        nextCFLoc: sarif.CodeFlowLocation,
        traversalPathId: string,
    ): Promise<CodeFlowStep> {

        let loc: Location;
        await Location.create(cFLoc.location.physicalLocation).then((location: Location) => {
            loc = location;
        });

        let isParentFlag = false;
        let isLastChildFlag = false;
        if (nextCFLoc !== undefined) {
            if ((cFLoc.nestingLevel < nextCFLoc.nestingLevel) ||
                (cFLoc.nestingLevel === undefined && nextCFLoc.nestingLevel !== undefined)) {
                isParentFlag = true;
            } else if (cFLoc.nestingLevel > nextCFLoc.nestingLevel ||
                (cFLoc.nestingLevel !== undefined && nextCFLoc.nestingLevel === undefined)) {
                isLastChildFlag = true;
            }
        }

        const message = Utilities.parseSarifMessage(cFLoc.location.message);
        let messageText = "";
        if (message !== undefined) {
            messageText = message.text;
        }

        if (messageText === "") {
            if (isLastChildFlag) {
                messageText = "[return call]";
            } else {
                messageText = "[no description]";
            }
        }

        let messageWithStepText = messageText;
        if (cFLoc.step !== undefined) {
            messageWithStepText = `Step ${cFLoc.step}: ${messageWithStepText}`;
        }

        const command = {
            arguments: [{
                request: "CodeFlowTreeSelectionChange",
                treeid_step: traversalPathId,
            }],
            command: ExplorerContentProvider.ExplorerCallbackCommand,
            title: messageWithStepText,
        } as Command;

        const step: CodeFlowStep = {
            codeLensCommand: command,
            importance: cFLoc.importance || sarif.CodeFlowLocation.importance.important,
            isLastChild: isLastChildFlag,
            isParent: isParentFlag,
            location: loc,
            message: messageText,
            messageWithStep: messageWithStepText,
            state: cFLoc.state,
            stepId: cFLoc.step,
            traversalId: traversalPathId,
        };

        return Promise.resolve(step);
    }
}