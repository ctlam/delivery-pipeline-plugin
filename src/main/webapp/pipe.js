var instance;
// Jenkins default view has a "main-panel" whereas full screen mode does not
var isFullScreen = (document.getElementById("main-panel") == null);
var numColumns = 0;
var pipelineutilsData = [];
var pipelineutils;
var storedPipelines = [];
var replayIsRunning = false;

function pipelineUtils() {
    var self = this;
    this.updatePipelines = function(divNames, errorDiv, view, fullscreen, page, component, showChanges, aggregatedChangesGroupingPattern, timeout, pipelineid, jsplumb) {

        // Prevent a pipeline update if a replay is running
        // The replay will automatically update the pipeline once it is complete
        if (replayIsRunning) {
            console.info("Replay is currently running. Will update pipeline after replay is complete.");
            return;
        }

        pipelineutils = this;
        pipelineutilsData.push(divNames, errorDiv, view, fullscreen, page, component, showChanges, aggregatedChangesGroupingPattern, timeout, pipelineid, jsplumb);
        // Keep track of the jsplumb instance so that we can repaint when necessary
        instance = jsplumb;

        Q.ajax({
            url: rootURL + "/" + view.viewUrl + 'api/json' + "?page=" + page + "&component=" + component + "&fullscreen=" + fullscreen,
            dataType: 'json',
            async: true,
            cache: false,
            timeout: 20000,
            success: function (data) {
                self.refreshPipelines(data, divNames, errorDiv, view, fullscreen, showChanges, aggregatedChangesGroupingPattern, pipelineid, jsplumb);
                setTimeout(function () {
                    self.updatePipelines(divNames, errorDiv, view, fullscreen, page, component, showChanges, aggregatedChangesGroupingPattern, timeout, pipelineid, jsplumb);
                }, timeout);
            },
            error: function (xhr, status, error) {
                Q("#" + errorDiv).html('Error communicating to server! ' + htmlEncode(error)).show();
                jsplumb.repaintEverything();
                setTimeout(function () {
                    self.updatePipelines(divNames, errorDiv, view, fullscreen, page, component, showChanges, aggregatedChangesGroupingPattern, timeout, pipelineid, jsplumb);
                }, timeout);
            }
        });
    }

    var lastResponse = null;

    this.refreshPipelines = function(data, divNames, errorDiv, view, showAvatars, showChanges, aggregatedChangesGroupingPattern, pipelineid, jsplumb) {
        var lastUpdate = data.lastUpdated,
            cErrorDiv = Q("#" + errorDiv),
            pipeline,
            component,
            html,
            trigger,
            triggered,
            contributors,
            tasks = [];

        if (isFullScreen) {
            document.onkeydown = function(evt) {
                evt = evt || window.event;
                if (evt.keyCode == 27) {
                    var returnUrl = window.location.href.split("?fullscreen=true")[0];
                    window.location.href = returnUrl;
                }
            };
        }

        window.addEventListener("scroll", storePagePosition);
        window.addEventListener("resize", rescaleConnections);
        window.addEventListener('webkitfullscreenchange', rescaleConnections);
        window.addEventListener('mozfullscreenchange', rescaleConnections);
        window.addEventListener('fullscreenchange', rescaleConnections);

        // Upon navigating away, delete the session storage resources set by this script
        window.onbeforeunload = function(){
            sessionStorage.removeItem("savedPipelineDisplayValues");
            sessionStorage.removeItem("savedPipelineArtifacts");
            sessionStorage.removeItem("savedStageDisplayValues");
            sessionStorage.removeItem("previousDisplayArgConfig");
            sessionStorage.removeItem("toggleStates");
            sessionStorage.removeItem("blockedOnFailedMap");
            sessionStorage.removeItem("markedUrls");
            sessionStorage.removeItem("pipelineStageIdMap");
            sessionStorage.removeItem("page_y");
        };

        var currentPageY;
        try {
            currentPageY = sessionStorage.getItem("page_y");
            if (currentPageY === undefined) {
                sessionStorage.page_y = 0;
                currentPageY = 0;
            }
        } catch (e) {
            console.info(e);
        }

        // Scroll to the top before drawing in fullscreen mode
        window.scrollTo( 0 , 0 );

        var blockingMap = {};       // Blocking project mapping
        var conditionalMap = {};    // Conditional project mapping
        var downstreamMap = {};     // Downstream project mapping
        var projectNameIdMap = {};  // Project Name - Project Id mapping

        // Initialize sessionStorage variables if not previously set
        if (sessionStorage.savedPipelineDisplayValues == null) {
            sessionStorage.savedPipelineDisplayValues = JSON.stringify({});
        }
        var savedPipelineDisplayValues = JSON.parse(sessionStorage.savedPipelineDisplayValues);

        if (sessionStorage.savedPipelineArtifacts == null) {
            sessionStorage.savedPipelineArtifacts = JSON.stringify({});
        }

        if (sessionStorage.savedStageDisplayValues == null) {
            sessionStorage.savedStageDisplayValues = JSON.stringify({});
        }

        if (sessionStorage.previousDisplayArgConfig == null) {
            sessionStorage.previousDisplayArgConfig = JSON.stringify({});
        }

        if (sessionStorage.toggleStates == null) {
            sessionStorage.toggleStates = JSON.stringify({});
        }

        if (sessionStorage.blockedOnFailedMap == null) {
            sessionStorage.blockedOnFailedMap = JSON.stringify({});
        }

        if (sessionStorage.markedUrls == null) {
            sessionStorage.markedUrls = JSON.stringify({});
        }

        if (data.error) {
            cErrorDiv.html('Error: ' + data.error).show();
        } else {
            cErrorDiv.hide().html('');
        }

        storedPipelines = [];

        // Get the display arguments from a specified project url
        var displayArgumentsFromFile = {};
        var firstComponent = null;

        if (data != null) {
            if (data.pipelines[0] != null) {
                firstComponent = data.pipelines[0];    
            }
        }
        if (firstComponent != null && !isNullOrEmpty(firstComponent.displayArgumentsFileContents)) {

            if (firstComponent.displayArgumentsFileContents.indexOf("could not be found in JENKINS_HOME/timeline-configs/") != -1) {
                cErrorDiv.html('Error: ' + firstComponent.displayArgumentsFileContents).show();
            } else if (firstComponent.displayArgumentsFileContents == "Could not find Jenkins root directory") {
                cErrorDiv.html('Error: ' + firstComponent.displayArgumentsFileContentss).show();
            } else {
                try {
                    // Attempt to parse the contents
                    if (data.useYamlParser) {
                        displayArgumentsFromFile = jsyaml.safeLoad(firstComponent.displayArgumentsFileContents);
                    } else {
                        displayArgumentsFromFile = JSON.parse(firstComponent.displayArgumentsFileContents);
                    }
                } catch (e) {
                    cErrorDiv.html('Error parsing display arguments file!').show();
                }
            }

        }

        // Get the display arguments in either YAML/JSON format.
        var displayArguments = {};
        try {
            // Attempt to parse the contents
            if (!isNullOrEmpty(data.displayArguments)) {
                if (data.useYamlParser) {
                    displayArguments = jsyaml.safeLoad(data.displayArguments);
                } else {
                    displayArguments = JSON.parse(data.displayArguments);
                }
            }
        } catch (e) {
            cErrorDiv.html('Error parsing display arguments!').show();
        }

        // Hope that jQuery can perform the deep merge
        try {
            displayArguments = Q.extend(true, {}, displayArgumentsFromFile, displayArguments);
        } catch (e) {
            console.log("Error performing deep merge on display arguments!");
        }
        
        if (lastResponse === null || JSON.stringify(data.pipelines) !== JSON.stringify(lastResponse.pipelines)) {

            for (var z = 0; z < divNames.length; z++) {
                Q("#" + divNames[z]).html('');
            }

            if (!data.pipelines || data.pipelines.length === 0) {
                Q("#pipeline-message-" + pipelineid).html('No pipelines configured or found! Please review the <a href="configure">configuration</a>')
            }

            jsplumb.reset();

            for (var c = 0; c < data.pipelines.length; c++) {
                html = [];
                component = data.pipelines[c];

                var returnUrl = window.location.href;
                if (isFullScreen) {
                    returnUrl = returnUrl.split("?fullscreen=true")[0];
                }

                html.push("<section class=\"pipeline-component\">");
                html.push("<div class=\"pipelineHeader\">");
                html.push("<h1><a href=\"" + returnUrl + "\" class=\"displayTableLink\">" + component.name + "</a></h1>");
                html.push("<h2>Refreshed every " + data.updateInterval + " seconds.");
                if (isFullScreen) {
                    html.push("<br/>Press ESC at any time to return to the default view.");
                }

                var firstJobName = component.firstJobUrl.substring(4, component.firstJobUrl.length - 1);
                if (displayArguments.hasOwnProperty(firstJobName)) {
                    if (displayArguments[firstJobName].hasOwnProperty("PipelineBuildStatus")) {
                        html.push("<br/><br/>Note: The pipeline status is determined by the status of the following jobs: [ " 
                            + replace(displayArguments[firstJobName].PipelineBuildStatus, ",", ", ") + " ]");

                        var allStages = "";
                        for (var i = 0; i < component.pipelines.length; i++) {
                            pipeline = component.pipelines[i];

                            for (var j = 0; j < pipeline.stages.length; j++) {
                                stage = pipeline.stages[j];

                                allStages += stage.name + ",";
                            }
                        }

                        var missingStages = "";
                        var projects = displayArguments[firstJobName].PipelineBuildStatus;

                        while (projects != "") {
                            var project = projects.split(",")[0];

                            if (allStages.indexOf(project) == -1) {
                                missingStages += project + ", ";
                            }

                            projects = projects.split(",").slice(1).join(",");    
                        }

                        if (missingStages != "") {
                            missingStages = missingStages.substring(0, missingStages.length - 2);
                            html.push("</h2><h2>Error: The following projects [ " + missingStages + " ] could not be found and will be ignored.");
                        }
                    }
                }

                html.push("</h2></div>");

                html.push("<div class=\"pipelineSecondaryHeader\">");
                if (!showAvatars) {
                    html.push("<div class='pagination'>");
                    html.push(component.pagingData);
                    html.push("</div>");
                }

                if (data.allowPipelineStart) {
                    html.push(generateButtons(c, component.firstJobParameterized, component.firstJobUrl, data.name));
                }
                html.push("</div>");
                
                if (component.pipelines.length === 0) {
                    html.push("No builds done yet.");
                }

                html.push("<table class=\"build_table\">");
                html.push("<tr>");
                html.push("<th class=\"build_header build_header_STATUS\">Status</th>");
                html.push("<th class=\"build_header build_header_BUILD_NUM\">Build Number</th>");
                html.push("<th class=\"build_header build_header_DURATION\">Duration</th>");
                html.push("<th class=\"build_header build_header_DATE\">Date</th>");
                html.push("<th class=\"build_header build_header_STARTED_BY\">Started by</th>");
                html.push("<th class=\"build_header build_header_REPLAY\">Replay</th>");
                html.push("</tr>");

                var isLatestPipeline = true;

                for (var i = 0; i < component.pipelines.length; i++) {
                    pipeline = component.pipelines[i];
                    storedPipelines.push(pipeline);

                    var jobName = component.firstJobUrl.substring(4, component.firstJobUrl.length - 1);
                    var buildNum = pipeline.version.substring(1);
                    var statusString = pipeline.stages[0].tasks[0].status.type;

                    for (var j = 0; j < pipeline.stages.length; j++) {
                        var stage = pipeline.stages[j];
                        var task = stage.tasks[0];

                        if (data.allowManualTriggers && task.manual && task.manualStep.enabled && task.manualStep.permission) {
                            statusString = "MANUAL";
                        }
                    }

                    var pipelineTimestamp = formatLongDate(pipeline.timestamp);
                    var pipelineDuration = formatLongDuration(pipeline.pipelineBuildTime);
                        
                    if (!data.useFullLocaleTimeStrings) {
                        pipelineTimestamp = formatDate(pipeline.timestamp);
                        pipelineDuration = formatDuration(pipeline.pipelineBuildTime);
                    }

                    if (pipeline.triggeredBy && pipeline.triggeredBy.length > 0) {
                        triggered = "";
                        for (var y = 0; y < pipeline.triggeredBy.length; y++) {
                            trigger = pipeline.triggeredBy[y];
                            triggered = triggered + trigger.description;
                            if (y < pipeline.triggeredBy.length - 1) {
                                triggered = triggered + ", ";
                            }
                        }
                    }

                    contributors = [];
                    if (pipeline.contributors) {
                        Q.each(pipeline.contributors, function (index, contributor) {
                            contributors.push(htmlEncode(contributor.name));
                        });
                    }

                    if (contributors.length > 0) {
                        triggered = triggered + " changes by " + contributors.join(", ");
                    }

                    var displayBuildId = "display-build-" + jobName + "-" + buildNum;
                    var toggleBuildId = "toggle-build-" + jobName + "-" + buildNum;
                    var toggleRowId = "toggle-row-" + jobName + "-" + buildNum;
                    var togglePipelineId = "toggle-pipeline-" + jobName + "-" + buildNum;
                    var shouldToggle = (getToggleState(toggleBuildId, "block", isLatestPipeline) != "none");

                    // Initial CSS class to use
                    var initClass = shouldToggle ? "toggled_build_header" : "untoggled_build_header";
                    var initPipelineClass = shouldToggle ? "toggled_pipeline" : "untoggled_pipeline";
                    var toggleFunction = "javascript:toggle('" + jobName + "','" + buildNum + "');";

                    html.push("<tr id=\"" + toggleRowId + "\" class=\"" + initClass + "\">");    
                    html.push("<td class=\"build_column\"><a href=\"" + toggleFunction + "\" style=\"text-decoration:none;\">");
                    html.push("<p id=\"" + jobName + "-" + buildNum + "-status\" class=\"circle_header circle_" + statusString + " build_circle\">&nbsp;</p></a></td>");

                    html.push("<td class=\"build_column\"><a href=\"" + toggleFunction + "\" style=\"text-decoration:none;\">");
                    html.push("<p class=\"build_entry\">#" + buildNum + " " + jobName + "</p></a></td>");

                    html.push("<td class=\"build_column\"><a href=\"" + toggleFunction + "\" style=\"text-decoration:none;\">");
                    html.push("<p class=\"build_entry\">" + pipelineDuration + "</p></a></td>");

                    html.push("<td class=\"build_column\"><a href=\"" + toggleFunction + "\" style=\"text-decoration:none;\">");
                    html.push("<p class=\"build_entry\">" + pipelineTimestamp + "</p></a></td>");

                    html.push("<td class=\"build_column\"><a href=\"" + toggleFunction + "\" style=\"text-decoration:none;\">");
                    html.push("<p class=\"build_entry\">" + triggered + "</p></a></td>");

                    html.push("<td class=\"build_column\"><a href=\"javascript:replay('" + i + "');\" style=\"text-decoration:none;\">");
                    html.push("<p id=\"replay-" + i + "\" class=\"replay replayDisabled build_circle\"></p></a></td>");

                    html.push("</tr><tr><th id=\"" + togglePipelineId + "\" colspan=\"6\" class=\"" + initPipelineClass + "\">");
                    html.push("<div id=\"" + toggleBuildId + "\" style=\"display:" + getToggleState(toggleBuildId, "block", isLatestPipeline) + ";\">");

                    // Only expand the latest pipeline
                    if (isLatestPipeline) {
                        isLatestPipeline = false;
                    }

                    if (pipeline.aggregated) {
                        if (component.pipelines.length > 1) {
                            html.push('<h3>Aggregated view</h3>');
                        }
                    } else {                                            
                        if (data.showTotalBuildTime) {
                            html.push('<h3>Total build time: ' + formatDuration(pipeline.totalBuildTime) + '</h3>');
                        }
                        
                        if (showChanges && pipeline.changes && pipeline.changes.length > 0) {
                            html.push(generateChangeLog(pipeline.changes));
                        }

                        html.push("<section class=\"pipeline-values\">");
                        html.push("<div class=\"pipeline-row\">");

                        if (JSON.stringify(displayArguments) != JSON.stringify({})) {
                            var toggleTableId = "toggle-table-" + jobName + "-" + buildNum;
                            var displayTableId = "display-table-" + jobName + "-" + buildNum;
                            var artifactId = "artifacts-" + jobName + "-" + buildNum;

                            var toggleTableFunction = "javascript:toggleTable('" + jobName + "','" + buildNum + "');";
                            var initDisplayValMessage = (getToggleState(toggleTableId, "table-row-group", true) == "none") ? "Show " : "Hide ";
                            initDisplayValMessage += "Global Display Values";

                            if (isFullScreen) {
                                toggleTableFunction = "javascript:toggleTableCompatibleFS('" + jobName + "','" + buildNum + "');";
                            }

                            html.push("<div class=\"pipeline-cell\" style=\"vertical-align: top;\">");

                            html.push("<table class=\"displayTable\" align=\"left\">");
                            html.push("<thead><tr><th colspan=\"2\" style=\"text-align: left;\" class=\"displayTableLink\">");
                            html.push("<a id=\"" + displayTableId + "\" href=\"" + toggleTableFunction + "\">" + initDisplayValMessage + "</a>");
                            html.push("</th></tr></thead>");
                            html.push("<tbody id=\"" + toggleTableId + "\" style=\"display: " + getToggleState(toggleTableId, "table-row-group", true) + ";\">");
                            if (data.showArtifacts) {
                                html.push("<tr class=\"displayTableTr\">");
                                html.push("<th class=\"displayTableTh\">Artifacts </th>");
                                html.push("<td id=\"" + artifactId + "\" class=\"displayTableTd\">" + loadBuildArtifacts(artifactId) + "</td></tr>");
                            }

                            if (JSON.stringify(savedPipelineDisplayValues) == JSON.stringify({})) {
                                html.push(generateGlobalDisplayValueTable(displayArguments, jobName, buildNum));
                            } else {
                                html.push(loadGlobalDisplayValues(displayArguments, jobName, buildNum, savedPipelineDisplayValues));
                            }

                            html.push("</tbody></table>");
                            html.push("</div>");
                        }

                        html.push("<div class=\"pipeline-cell\">");

                        html.push("<table class=\"displayTable\" align=\"right\"><thead><tr>");
                        html.push("<th colspan=\"2\" style=\"text-align: left; color: inherit;\">Legend</th>");
                        html.push("</tr></thead>");
                        html.push("<tbody style=\"display: table-row-group;\">");

                        var idSuffix = jobName + "-" + buildNum;

                        html.push("<tr class=\"displayTableTr legendRow\">");
                        html.push("<th id=\"nb-" + idSuffix + "\" class=\"displayTableTh legendTh\"></th>");
                        html.push("<td id=\"nb-" + idSuffix + "-end\" class=\"displayTableTd legendTd\">Non-blocking</td></tr>");

                        html.push("<tr class=\"displayTableTr legendRow\">");
                        html.push("<th id=\"b-" + idSuffix + "\" class=\"displayTableTh legendTh\"></th>");
                        html.push("<td id=\"b-" + idSuffix + "-end\" class=\"displayTableTd legendTd\">Blocking</td></tr>");

                        html.push("<tr class=\"displayTableTr legendRow\">");
                        html.push("<th id=\"nbc-" + idSuffix + "\" class=\"displayTableTh legendTh\"></th>");
                        html.push("<td id=\"nbc-" + idSuffix + "-end\" class=\"displayTableTd legendTd\">Non-blocking Conditional</td></tr>");

                        html.push("<tr class=\"displayTableTr legendRow\">");
                        html.push("<th id=\"bc-" + idSuffix + "\" class=\"displayTableTh legendTh\"></th>");
                        html.push("<td id=\"bc-" + idSuffix + "-end\" class=\"displayTableTd legendTd\">Blocking Conditional</td></tr>");

                        html.push("<tr class=\"displayTableTr legendRow\">");
                        html.push("<th id=\"d-" + idSuffix + "\" class=\"displayTableTh legendTh\"></th>");
                        html.push("<td id=\"d-" + idSuffix + "-end\" class=\"displayTableTd legendTd\">Downstream</td></tr>");

                        html.push("</tbody></table>");
                        html.push("</div></div></section>");
                    }

                    // 15px padding around main-panel
                    // 10px padding around pipeline-main
                    // 1px border left/right around pipeline main
                    // 1px border left/right around table
                    // There is also some additional padding elsewhere, so assume 100px in padding to ensure enough room
                    var maxWidth =  isFullScreen ? window.innerWidth - 100 : document.getElementById("main-panel").offsetWidth - 100;
                    for (var j = 0; j < pipeline.stages.length; j++) {
                        stage = pipeline.stages[j];
                        if (stage.column >= numColumns) {
                            numColumns = stage.column + 1;
                        }
                    }

                    var scaleCondition = (numColumns * 140 > maxWidth);

                    // Default Values
                    var widthPerCell = 130; // 10px for margin-right
                    var circleSizePerCell = "26px";
                    var leftPercentPerCell = "37.5%";
                    var fontSizePerCell = 12;

                    if (scaleCondition) {
                        widthPerCell = Math.floor(maxWidth / numColumns) - 10;
                        circleSizePerCell = (widthPerCell >= 26) ? "26px" : widthPerCell + "px";
                        leftPercentPerCell = Math.floor(((widthPerCell - parseInt(circleSizePerCell.replace("px", ""))) / 2) / widthPerCell * 100) + "%";
                        fontSizePerCell = 10; // Set a minimum font-size rather than scaling it down to something unreadable
                    }

                    var row = 0, column = 0, stage;
                    var shiftedOneColumn = false;                             
                    html.push("<section class=\"pipeline\">");
                    html.push('<div class="pipeline-row">');

                    for (var j = 0; j < pipeline.stages.length; j++) {

                        stage = pipeline.stages[j];

                        if (stage.blockingJobs.length > 0) {
                            blockingMap[getStageId(stage.id + "", i)] = stage.blockingJobs;
                        }
                        if (stage.conditionalJobs.length > 0) {
                            conditionalMap[getStageId(stage.id + "", i)] = stage.conditionalJobs;
                        }
                        if (stage.downstreamJobs.length > 0) {
                            downstreamMap[getStageId(stage.id + "", i)] = stage.downstreamJobs;
                        }

                        projectNameIdMap[getStageId(stage.id + "", i)] = stage.name;

                        if (stage.row > row) {
                            html.push('</div><div class="pipeline-row">');
                            column = 0;
                            row++;
                            shiftedOneColumn = false;
                        }

                        if (numColumns <= 3 && !shiftedOneColumn) {
                            shiftedOneColumn = true;
                            html.push("<div class=\"pipeline-cell\">");
                            html.push("<div class=\"stage hide\" style=\"width: " + widthPerCell + "px;\"></div></div>");
                        }

                        if (stage.column > column) {
                            for (var as = column; as < stage.column; as++) {
                                html.push("<div class=\"pipeline-cell\">");
                                html.push("<div class=\"stage hide\" style=\"width: " + widthPerCell + "px;\"></div></div>");
                                column++;
                            }
                        }

                        html.push("<div class=\"pipeline-cell\">");

                        var link = getLink(data, stage.tasks[0].link);
                        var buildStatus = stage.tasks[0].status;
                        if (data.linkToConsoleLog) {
                            if (buildStatus.success || buildStatus.failed || buildStatus.unstable || buildStatus.cancelled) {
                                link += "console";
                            }
                        }

                        html.push("<div class=\"stage\" style=\"width: " + widthPerCell + "px;\">");    
                        html.push("<div class=\"stage-header\" style=\"font-size: " + fontSizePerCell + "px;\">");
                        html.push("<div class=\"stage-name\">");
                        html.push("<a href=\"" + link + "\" target=\"_blank\" id=\"" + stage.name + "-" + i + "\">");

                        if (isNullOrEmpty(stage.tasks[0].buildId)) {
                            html.push("#N/A " + stage.name + "</a></div>");
                            } else {
                            html.push("#" + stage.tasks[0].buildId + " " + stage.name + "</a></div>");
                        }

                        if (!pipeline.aggregated) {
                            html.push('</div>');
                        } else {
                            var stageversion = stage.version;
                            if (!stageversion) {
                                stageversion = "N/A"
                            }
                            html.push(' <div class="stage-version">' + htmlEncode(stageversion) + '</div></div>');
                        }

                        var task, id, timestamp, progress, progressClass, consoleLogLink = "";

                        for (var k = 0; k < stage.tasks.length; k++) {
                            task = stage.tasks[k];

                            id = getTaskId(task.id, i);
                            timestamp = data.useFullLocaleTimeStrings ? formatLongDate(task.status.timestamp) : formatDate(task.status.timestamp, lastUpdate);
                            
                            tasks.push({id: id, taskId: task.id, buildId: task.buildId});

                            progress = 100;
                            progressClass = "task-progress-notrunning";
                            var taskHeader = task.name + "/" + task.buildId;

                            if (task.status.percentage) {
                                progress = task.status.percentage;
                                progressClass = "task-progress-running";
                            } else if (data.linkToConsoleLog) {
                                if (task.status.success ||
                                   task.status.failed ||
                                   task.status.unstable ||
                                   task.status.cancelled) {
                                   consoleLogLink = "console";
                                   taskHeader = "Console";
                               }
                            }

                            var toolTipStyle = Math.round(column / numColumns) < 0.5 ? "left: 0%;" : "right: 0%;"
                            var hoverTable = "<table class=\"hoverTable\"><tr class=\"hoverRow\">";
                            hoverTable += "<th class=\"hoverTableTh\">Status:</th>";
                            hoverTable += "<td class=\"hoverTableTd\">" + task.status.type + "</td></tr><tr class=\"hoverRow\">"
                            hoverTable += "<th class=\"hoverTableTh\">Timestamp:</th>";
                            hoverTable += "<td class=\"hoverTableTd\">" + timestamp + "</td></tr><tr class=\"hoverRow\">";
                            hoverTable += "<th class=\"hoverTableTh\">Duration:</th>";
                            hoverTable += "<td class=\"hoverTableTd\">" + formatLongDuration(task.status.duration) + "</td></tr>";

                            if (task.status.promoted) {
                                hoverTable += "<tr class=\"hoverRow\">";
                                hoverTable += "<th class=\"hoverTableTh\">Promoted:</th>";
                                hoverTable += "<td class=\"hoverTableTd\">TRUE</td></tr>";
                            }

                            hoverTable += generateStageDisplayValueTable(displayArguments, jobName, stage.name, stage.tasks[0].buildId, getStageId(stage.id + "", i));
                            
                            for (var l = 0; l < stage.previousTasks.length; l++) {
                                previousTask = stage.previousTasks[l];

                                hoverTable += "<tr class=\"hoverRow\">";
                                hoverTable += "<th class=\"hoverTableTh\" colspan=\"2\">&nbsp;</th>";
                                hoverTable += "</tr>"

                                hoverTable += "<tr class=\"hoverRow\">";
                                hoverTable += "<th class=\"hoverTableTh\">Other Builds Triggered:</th>";
                                hoverTable += "<td class=\"hoverTableTd\">" + "#" + previousTask.buildId + "</td></tr><tr class=\"hoverRow\">"
                                hoverTable += "<th class=\"hoverTableTh\">Status:</th>";
                                hoverTable += "<td class=\"hoverTableTd\">" + previousTask.status.type + "</td></tr><tr class=\"hoverRow\">"
                                hoverTable += "<th class=\"hoverTableTh\">Timestamp:</th>";
                                hoverTable += "<td class=\"hoverTableTd\">" + formatLongDate(previousTask.status.timestamp) + "</td></tr><tr class=\"hoverRow\">";
                                hoverTable += "<th class=\"hoverTableTh\">Duration:</th>";
                                hoverTable += "<td class=\"hoverTableTd\">" + formatLongDuration(previousTask.status.duration) + "</td></tr>";

                                if (previousTask.status.promoted) {
                                    hoverTable += "<tr class=\"hoverRow\">";
                                    hoverTable += "<th class=\"hoverTableTh\">Promoted:</th>";
                                    hoverTable += "<td class=\"hoverTableTd\">TRUE</td></tr>";
                                }

                                hoverTable += generateStageDisplayValueTable(displayArguments, jobName, stage.name, previousTask.buildId, getStageId(stage.id + "", i));
                            }

                            if (data.allowManualTriggers && task.manual && task.manualStep.enabled && task.manualStep.permission) {
                                hoverTable += "<tr class=\"hoverRow\">";
                                hoverTable += "<th class=\"hoverTableTh\" colspan=\"2\">&nbsp;</th>";
                                hoverTable += "</tr>"

                                hoverTable += "<tr class=\"hoverRow\">";
                                hoverTable += "<th class=\"hoverTableTh\" colspan=\"2\">Awaiting Manual Trigger</th>";
                                hoverTable += "</tr>";
                            }

                            hoverTable += "</table>";

                            html.push("<div id=\"" + id + "\" class=\"stage-task\">");
                            html.push("<div class=\"task-header\">");
                            html.push("<div class=\"taskname\">");

                            // Manual trigger
                            if (data.allowManualTriggers && task.manual && task.manualStep.enabled && task.manualStep.permission) {
                                html.push("<a id=\"" + getStageId(stage.id + "", i) + "\" class=\"circle circle_MANUAL\" ");
                                html.push("onclick=\"triggerManual('" + id + "', '" + task.id + "', '" + task.manualStep.upstreamProject + "', '" + task.manualStep.upstreamId +  "', '" + view.viewUrl + "'); refreshFn(false)\" ");
                                html.push("style=\"left: " + leftPercentPerCell + "; height: " + circleSizePerCell + "; width: " + circleSizePerCell + "; ");
                                html.push("background-size: " + circleSizePerCell + " " + circleSizePerCell + ";\">");
                                html.push("<br/><span class=\"tooltip\" style=\"" + toolTipStyle + "\">" + hoverTable + "</span></a>");
                            } else {
                                html.push("<a id=\"" + getStageId(stage.id + "", i) + "\" class=\"circle circle_" + task.status.type + "\" ");
                                html.push("href=\"" + getLink(data, task.link) + consoleLogLink + "\" target=\"_blank\" ");
                                html.push("style=\"left: " + leftPercentPerCell + "; height: " + circleSizePerCell + "; width: " + circleSizePerCell + "; ");
                                html.push("background-size: " + circleSizePerCell + " " + circleSizePerCell + ";\">");
                                html.push("<br/><span class=\"tooltip\" style=\"" + toolTipStyle + "\">" + hoverTable + "</span></a>");
                            }
                            
                            html.push("</div></div></div>");
                        }

                        html.push("</div></div>");
                        column++;

                        // Ensure no cell can be more than 20% of the pipeline-row
                        if (numColumns < 5 && j == pipeline.stages.length - 1) {
                            var numAdditionalColumnsToAdd = 5 - numColumns;

                            if (numColumns <= 3) {
                                numAdditionalColumnsToAdd--;
                            }

                            for (var m = 0; m < numAdditionalColumnsToAdd; m++) {
                                html.push("<div class=\"pipeline-cell\">");
                                html.push("<div class=\"stage hide\" style=\"width: " + widthPerCell + "px;\"></div></div>");
                            }
                        }
                    }
                    html.push('</div></section></div></th></tr>');
                }

                html.push("</table>")
                html.push("</section>");
                html.push("<br/>");
                Q("#" + divNames[c % divNames.length]).append(html.join(""));
                Q("#pipeline-message-" + pipelineid).html('');
            }

            var pipelineStageIdMap = {};

            // Update global pipeline data if every stage in the pipeline has run to completion.
            // Update stage specific data if the stage has run to completion.
            // Create a pipeline - stage id mapping for later use.
            for (var i = 0; i < component.pipelines.length; i++) {
                var pipeline = component.pipelines[i];
                var pipelineNum = pipeline.version.substring(1);
                var jobName = component.firstJobUrl.substring(4, component.firstJobUrl.length - 1);
                var buildNum = pipeline.version.substring(1);
                var allStagesComplete = true;
                var toggleBuildId = "toggle-build-" + jobName + "-" + buildNum;
                var stageIds = {};

                for (var j = 0; j < pipeline.stages.length; j++) {
                    var stage = pipeline.stages[j];
                    var stageStatus = stage.tasks[0].status.type;
                    var id = getStageId(stage.id + "", i);
                    stageIds[id] = "true";

                    // Check if every stage is complete
                    if (stageStatus == "QUEUED" || stageStatus == "RUNNING") {
                        allStagesComplete = false;
                    }

                    // Update specific stage display values if the stage has finished
                    if (stageStatus.success || stageStatus.failed || stageStatus.unstable || stageStatus.cancelled) {
                        getStageDisplayValues(displayArguments, jobName, stage.name, stage.tasks[0].buildId, id);

                        for (var k = 0; k < stage.previousTasks.length; k++) {
                            var prevTask = stage.previousTasks[k];
                            getStageDisplayValues(displayArguments, jobName, stage.name, prevTask.buildId, id);
                        }
                    }
                }
                pipelineStageIdMap[toggleBuildId] = stageIds;

                // Update the build status of the pipeline by checking the status of a user defined job(s)
                getCustomPipelineBuildStatus(displayArguments, pipeline, jobName, buildNum, allStagesComplete);

                if (allStagesComplete) {
                    if (data.showArtifacts) {
                        var artifactValues = JSON.parse(sessionStorage.savedPipelineArtifacts);
                        var artifactId = "artifacts-" + jobName + "-" + buildNum;

                        // Update top level artifacts
                        if (!artifactValues.hasOwnProperty(artifactId)) {
                            getBuildArtifacts(jobName, buildNum, artifactId);    
                        }
                    }

                    // Update global display values
                    getGlobalDisplayValues(displayArguments, pipeline, jobName, pipelineNum);

                    // Mark the stages that failed on a blocking call
                    if (!JSON.parse(sessionStorage.blockedOnFailedMap).hasOwnProperty(pipeline.stages[0].name + "-" + pipelineNum)) {
                        updateFailedOnBlockStages(pipeline, i);    
                    } else {
                        loadFailedOnBlockStages(pipeline, i);
                    }

                    var replayEle = document.getElementById("replay-" + i);
                    replayEle.className = "replay replayStopped build_circle";
                }
            }

            // Update the previous display argument configuration after all new values have been found
            if (!_.isEqual(JSON.parse(sessionStorage.previousDisplayArgConfig), displayArguments)) {
                console.info("Timeline config has been changed -- Reloading display values!")
                sessionStorage.previousDisplayArgConfig = JSON.stringify(displayArguments);
            }

            sessionStorage.pipelineStageIdMap = JSON.stringify(pipelineStageIdMap);

            var index = 0, source, target;
            var anchors = [[1, 0, 1, 0, 0, 13], [0, 0, -1, 0, 0, 13]];
            var backgroundColor = "rgba(31,35,41,1)";

            lastResponse = data;

            // use jsPlumb to draw the connections between stages
            Q.each(data.pipelines, function (i, component) {
                Q.each(component.pipelines, function (j, pipeline) {
                    index = j;

                    var stageToNameMap = {};
                    var stageIdToCountMap = {};

                    // Map each stage id to the number of upstream jobs calling it
                    // Map each stage name to the stage
                    for (var a = 0; a < pipeline.stages.length; a++) {
                        var stage = pipeline.stages[a];
                        stageToNameMap[stage.name] = stage;
                        for (var b = 0; b < stage.downstreamStageIds.length; b++) {
                            var downstreamId = getStageId(stage.downstreamStageIds[b] + "", index);
                            if (stageIdToCountMap.hasOwnProperty(downstreamId)) {
                                stageIdToCountMap[downstreamId]++;
                            } else {
                                stageIdToCountMap[downstreamId] = 0;
                            }
                        }
                    }

                    // Temporary Hack in place... 
                    // The legend for single stage pipelines is not being drawn properly if nothing is drawn here
                    // For now, draw an "invisible" line to fix the legend issue
                    // TODO: Determine root cause and rip out this block of code
                    if (pipeline.stages.length == 1) {
                        stage = pipeline.stages[0];
                        jsplumb.connect({
                            source: getStageId(stage.id + "", index),
                            target: getStageId(stage.id + "", index),
                            anchors: [[1, 0, 1, 0, 0, 13], [1, 0, 1, 0, 0, 13]],
                            connector: ["Flowchart", { stub: 20, gap: 1, midpoint: 0, alwaysRespectStubs: true }],
                            paintStyle: { stroke: "rgba(31,35,41,1)", strokeWidth: 1 },
                            endpoint: "Blank"
                        });
                    }

                    Q.each(pipeline.stages, function (k, stage) {
                        if (stage.downstreamStages) {
                            Q.each(stage.downstreamStageIds, function (l, value) {
                                source = getStageId(stage.id + "", index);
                                target = getStageId(value + "", index);
                                
                                var scope = "pipeline-nb";
                                var color = "rgba(0,122,195,1)";    // Default blue
                                var label = "Non-blocking";         // Default non-blocking
                                var dashstyle = "2 2";              // Default dashed line
                                var strokeWidth = 3.5;              // Default line width of 3.5
                                var stub = scaleCondition ? 30 : 80;
                                var lastBlockingJob;
                                var downstreamAnchors = [[0.5, 1, 0, 1, 0, 1], [0, 0, -1, 0, -0.5, 13]];

                                var blockedProjects = conditionalProjects = downstreamProjects = [];
                                var targetName;
                                var isBlocking = false;
                                if (blockingMap.hasOwnProperty(source)) {
                                    blockedProjects = blockingMap[source];
                                    lastBlockingJob = blockedProjects[blockedProjects.length - 1];
                                }

                                if (conditionalMap.hasOwnProperty(source)) {
                                    conditionalProjects = conditionalMap[source];
                                }

                                if (downstreamMap.hasOwnProperty(source)) {
                                    downstreamProjects = downstreamMap[source];
                                }

                                if (projectNameIdMap.hasOwnProperty(target)) {
                                    var targetName = projectNameIdMap[target];

                                    if (blockedProjects.indexOf(targetName) != -1 && 
                                        conditionalProjects.indexOf(targetName) != -1) {
                                        color = "rgba(255,121,52,1)";   // Orange
                                        label = "Blocking Conditional";
                                        dashstyle = "0 0";
                                        scope = "pipeline-bc";
                                        isBlocking = true;
                                    } else if (blockedProjects.indexOf(targetName) != -1) {
                                        color = "rgba(0,122,195,1)";    // Blue
                                        label = "Blocking";
                                        dashstyle = "0 0";
                                        scope = "pipeline-b";
                                        isBlocking = true;
                                    } else if (conditionalProjects.indexOf(targetName) != -1) {
                                        color = "rgba(255,121,52,1)";   // Orange
                                        label = "Non-blocking Conditional";
                                        scope = "pipeline-nbc";
                                    }
                                    if (downstreamProjects.indexOf(targetName) != -1) {
                                        color = "rgba(118,91,161,1)";   // Purple
                                        label = "Downstream";
                                        stub = 10;
                                        scope = "pipeline-d";

                                        for (var j = 0; j < pipeline.stages.length; j++) {
                                            tmpStage = pipeline.stages[j];

                                            if (value == tmpStage.id) {

                                                if (tmpStage.row <= stage.row) {
                                                    stub = scaleCondition ? 30 : 80;
                                                    downstreamAnchors = anchors;
                                                    break;
                                                }
                                            }
                                        }
                                    }
                                }

                                var isRunning = false;
                                if (stageToNameMap.hasOwnProperty(targetName)
                                        && stageToNameMap[targetName].tasks[0].status.type == "RUNNING") {

                                    // Multiple sources -- need to look up what the calling job is
                                    if (stageIdToCountMap[target] > 1) {
                                        var sourceName = getStageSource(targetName, stageToNameMap[targetName].tasks[0].buildId);
                                        if (sourceName == stage.name) {
                                            color = "yellow";
                                            isRunning = true;
                                        }
                                    } else {
                                        // Only 1 source (0 sources for the first job)
                                        color = "yellow";
                                        isRunning = true;
                                    }
                                }

                                var isDownstreamProject = (downstreamProjects.indexOf(targetName) != -1);
                                var connector = ["Flowchart", {
                                    stub: stub,
                                    gap: 0,
                                    midpoint: 0,
                                    alwaysRespectStubs: false,
                                    cornerRadius: 20
                                }];

                                // Draw a hidden connection to hide the bad line overlapping
                                // Only do it if there is a mix of conditional and blocking jobs
                                if (lastBlockingJob == projectNameIdMap[target] &&
                                    conditionalMap.hasOwnProperty(source)) {

                                    var hideBadOverlapConn = jsplumb.connect({
                                        source: source,
                                        target: target,
                                        anchors: anchors,
                                        connector: connector,
                                        paintStyle: { 
                                            stroke: backgroundColor,
                                            strokeWidth: strokeWidth,
                                            outlineStroke: backgroundColor,
                                            outlineWidth: 0.5
                                        },
                                        endpoint: "Blank"
                                    });

                                    hideBadOverlapConn.bind("mouseover", function(conn) {
                                        conn.setHover(false);
                                    });
                                }

                                // Add a hidden connection behind the actual connection
                                // Due to the nature of dashed lines, hovering over the gaps in the line
                                // will not be considered "hovering". We can remedy this by setting a mouseover/out
                                // event on this hidden connection.
                                var hiddenConn;
                                if (dashstyle != "0 0") {
                                    hiddenConn = jsplumb.connect({
                                        source: source,
                                        target: target,
                                        anchors: isDownstreamProject ? downstreamAnchors : anchors,
                                        connector: connector,
                                        paintStyle: {
                                            stroke: "rgba(31,35,41,1)",
                                            strokeWidth: strokeWidth
                                        },
                                        endpoint: "Blank"
                                    });
                                }

                                // The primary connection
                                // Add a scope to these connections for replay
                                var connection = jsplumb.connect({
                                    source: source,
                                    target: target,
                                    // allow boxes to increase in height but keep anchor lines on the top
                                    anchors: isDownstreamProject ? downstreamAnchors : anchors, 
                                    overlays: [
                                        [ "Arrow", { location: 1, foldback: 0.9, width: 12, length: 12 }]
                                    ],
                                    connector: connector,
                                    paintStyle: { stroke: color, strokeWidth: strokeWidth, dashstyle: dashstyle },
                                    hoverPaintStyle: { strokeWidth: (strokeWidth * 1.5) },
                                    endpoint: "Blank",
                                    scope: scope
                                });

                                // Add a higher z-index for running connections and/or blocking connections
                                if (isRunning) {
                                    connection.addClass("running");
                                } else {
                                    if (isBlocking) {
                                        connection.addClass("blocking");
                                    }
                                }

                                connection.bind("mouseover", function(conn) {
                                    conn.addOverlay([ "Label", { 
                                        label: label,
                                        id: (target + "-label"),
                                        location: 0.6,
                                        cssClass: "label"
                                    }]);
                                    conn.addOverlay([ "Arrow", {
                                        id: (target + "-arrow"),
                                        location: 1,
                                        foldback: 0.9,
                                        width: 18,
                                        length: 18
                                    }]);
                                }); 

                                connection.bind("mouseout", function(conn) {
                                    conn.removeOverlay((target + "-label"));
                                    conn.removeOverlay((target + "-arrow"));
                                });

                                // Add the hidden connection mouse events
                                if (dashstyle != "0 0") {
                                    hiddenConn.bind("mouseover", function(conn) {
                                        // Always false
                                        conn.setHover(false);
                                        connection.setHover(true);
                                        connection.addOverlay([ "Label", {
                                            label: label,
                                            id: (target + "-label"),
                                            location: 0.6,
                                            cssClass: "label"
                                        }]);
                                        connection.addOverlay([ "Arrow", {
                                            id: (target + "-arrow"),
                                            location: 1,
                                            foldback: 0.9,
                                            width: 18,
                                            length: 18
                                        }]);
                                    }); 

                                    hiddenConn.bind("mouseout", function(conn) {
                                        conn.setHover(false);
                                        connection.setHover(false);
                                        connection.removeOverlay((target + "-label"));
                                        connection.removeOverlay((target + "-arrow"));
                                    });
                                }
                            });
                        }
                    });
                });
            });

            // Draw the legend for every row
            for (var a = 0; a < data.pipelines.length; a++) {
                var component = data.pipelines[a];
                var isLatestPipeline = true;

                for (var i = 0; i < component.pipelines.length; i++) {
                    pipeline = component.pipelines[i];

                    var jobName = component.firstJobUrl.substring(4, component.firstJobUrl.length - 1);
                    var buildNum = pipeline.version.substring(1);

                    var legendMap = {};

                    legendMap["b-"   + jobName + "-" + buildNum] = ["rgba(0,122,195,1)", "0 0"];
                    legendMap["nb-"  + jobName + "-" + buildNum] = ["rgba(0,122,195,1)", "2 2"];
                    legendMap["nbc-" + jobName + "-" + buildNum] = ["rgba(255,121,52,1)", "2 2"];
                    legendMap["bc-"  + jobName + "-" + buildNum] = ["rgba(255,121,52,1)", "0 0"];
                    legendMap["d-"   + jobName + "-" + buildNum] = ["rgba(118,91,161,1)", "2 2"];

                    for (var key in legendMap) {
                        jsplumb.connect({
                            source: key,
                            target: key + "-end",
                            anchors: [[0, 0.5, 1, 0, 1, 0], [0, 0.5, -1, 0, 2, 0]],
                            connector: ["Flowchart", {
                                stub: 0,
                                gap: 0,
                                midpoint: 0,
                                alwaysRespectStubs: false,
                                cornerRadius: 0
                            }],
                            paintStyle: { stroke: legendMap[key][0], strokeWidth: 3, dashstyle: legendMap[key][1] },
                            endpoint: "Blank"
                        });
                    }
                }
            }

            var pipelineStageIdMap = JSON.parse(sessionStorage.pipelineStageIdMap);
            // Hide all connectors in untoggled rows
            for (var a = 0; a < data.pipelines.length; a++) {
                var component = data.pipelines[a];
                var isLatestPipeline = true;

                for (var i = 0; i < component.pipelines.length; i++) {
                    pipeline = component.pipelines[i];

                    var jobName = component.firstJobUrl.substring(4, component.firstJobUrl.length - 1);
                    var buildNum = pipeline.version.substring(1);
                    var toggleBuildId = "toggle-build-" + jobName + "-" + buildNum;
                    var legendSuffix = jobName + "-" + buildNum;

                    if (getToggleState(toggleBuildId, "block", isLatestPipeline) == "none") {
                        var stageIds = pipelineStageIdMap[toggleBuildId];

                        // Hide the stage connectors
                        for (var key in stageIds) {
                            jsplumb.hide(key);
                        }

                        // Hide the legend connectors
                        jsplumb.hide("b-" + legendSuffix);
                        jsplumb.hide("nb-" + legendSuffix);
                        jsplumb.hide("nbc-" + legendSuffix);
                        jsplumb.hide("bc-" + legendSuffix);
                        jsplumb.hide("d-" + legendSuffix);
                    }
                    if (isLatestPipeline) {
                        isLatestPipeline = false;
                    }
                }
            }
        } else {
            var comp, pipe, head, st, ta, time;

            for (var p = 0; p < data.pipelines.length; p++) {
                comp = data.pipelines[p];
                for (var d = 0; d < comp.pipelines.length; d++) {
                    pipe = comp.pipelines[d];
                    head = document.getElementById(pipe.id);
                    if (head) {
                        head.innerHTML = formatDate(pipe.timestamp, lastUpdate)
                    }

                    for (var l = 0; l < pipe.stages.length; l++) {
                        st = pipe.stages[l];
                        for (var m = 0; m < st.tasks.length; m++) {
                            ta = st.tasks[m];
                            time = document.getElementById(getTaskId(ta.id, d) + ".timestamp");
                            if (time) {
                                time.innerHTML = formatDate(ta.status.timestamp, lastUpdate);
                            }
                        }
                    }
                }
            }
        }
        jsplumb.repaintEverything();
        window.scrollTo( 0, currentPageY );
    }
}

/**
 * Redraws all the connections.
 */
function redrawConnections() {
    instance.repaintEverything();
}

/**
 * Revalidates all the connections, recalculates the offsets and redraws all the connections.
 */
function revalidateConnections() {
    if (isFullScreen) {
        var pipelineStageIdMap = JSON.parse(sessionStorage.pipelineStageIdMap);

        window.scrollTo(0, 0);
        instance.revalidate();

        // Recalculate offsets for every stage
        for (var pipeline in pipelineStageIdMap) {
            for (var stage in pipelineStageIdMap[pipeline]) {
                instance.recalculateOffsets(stage);
            }
        }

        redrawConnections();
        window.scrollTo(0, sessionStorage.getItem("page_y"));
    } else {
        redrawConnections();
    }    
}

/**
 * Rescales and redraws the pipeline.
 */
function rescaleConnections() {
    var maxWidth =  isFullScreen ? window.innerWidth - 100 : document.getElementById("main-panel").offsetWidth - 100;
    var scaleCondition = (numColumns * 140 > maxWidth);

    // Default Values
    var widthPerCell = 130; // 10px for margin-right
    var circleSizePerCell = "26px";
    var leftPercentPerCell = "37.5%";
    var fontSizePerCell = 12;

    if (scaleCondition) {
        widthPerCell = Math.floor(maxWidth / numColumns) - 10;
        circleSizePerCell = (widthPerCell >= 26) ? "26px" : widthPerCell + "px";
        leftPercentPerCell = Math.floor(((widthPerCell - parseInt(circleSizePerCell.replace("px", ""))) / 2) / widthPerCell * 100) + "%";
        fontSizePerCell = 10; // Set a minimum font-size rather than scaling it down to something unreadable
    }

    Q(".stage").css("width", widthPerCell);
    Q(".circle").css("left", leftPercentPerCell);
    Q(".circle").css("height", circleSizePerCell);
    Q(".circle").css("width", circleSizePerCell);
    Q(".circle").css("background-size", circleSizePerCell + " " + circleSizePerCell);

    revalidateConnections();
}

/**
 * Opens the link in a new tab, keeping focus on the current tab.
 */
function openNewTabInBackground(url) {
    var ele = document.createElement("a");
    ele.href = url;
    ele.target = "_blank";
    ele.style.visibility = "hidden";
    document.body.appendChild(ele);

    var event = document.createEvent('MouseEvents');
    var opts = { // These are the default values, set up for un-modified left clicks
        type: 'click',
        canBubble: true,
        cancelable: true,
        view: window,
        detail: 1,
        screenX: 0, //The coordinates within the entire page
        screenY: 0,
        clientX: 0, //The coordinates within the viewport
        clientY: 0,
        ctrlKey: true,
        altKey: false,
        shiftKey: false,
        metaKey: false, //I *think* 'meta' is 'Cmd/Apple' on Mac, and 'Windows key' on Win. Not sure, though!
        button: 0, //0 = left, 1 = middle, 2 = right
        relatedTarget: null,
    };

    event.initMouseEvent(
        opts.type,
        opts.canBubble,
        opts.cancelable,
        opts.view,
        opts.detail,
        opts.screenX,
        opts.screenY,
        opts.clientX,
        opts.clientY,
        opts.ctrlKey,
        opts.altKey,
        opts.shiftKey,
        opts.metaKey,
        opts.button,
        opts.relatedTarget
    );

    var is_chrome = navigator.userAgent.toLowerCase().indexOf('chrome') > -1;
    
    if(!is_chrome) {
        console.info("Using firefox!");
        ele.click();
    } else {
        console.info("Using chrome!");
        ele.dispatchEvent(event);
    }
}

function isNullOrEmpty(strValue) {
    return ((strValue == null) || (strValue == ""));
}

function getLink(data, link) {
    if (data.linkRelative) {
        return link;
    } else {
        return rootURL + "/" + link;
    }
}

function generateButtons(c, firstJobParameterized, firstJobUrl, name) {
    var retVal = "";
    var buildTriggerMessage = firstJobParameterized ? "Trigger New Parameterized Build" : "Trigger New Build";
    var triggerFunction = firstJobParameterized ? "triggerParameterizedBuild" : "triggerBuild";

    var html = ["<div class=\"button buttonTrigger\">"];
    html.push("<a id=\"startpipeline-" + c  + "\" href=\"javascript:void(0);\" onclick=\"" + triggerFunction 
        + "('" + firstJobUrl + "', '" + name + "');\" style=\"text-decoration:none;\">");
        html.push("<p class=\"buttonText\">" + buildTriggerMessage + "</p>");
        html.push("</a>");
    html.push("</div>");

    html.push("<div class=\"button buttonRefresh\">");
        html.push("<a id=\"refreshpipeline-" + c  + "\" href=\"javascript:void(0);\" onclick=\"refreshFn(true);\" style=\"text-decoration:none;\">");
            html.push("<p class=\"buttonText\">Refresh Pipeline</p>");
        html.push("</a>");
    html.push("</div>");

    var editConfigUrl = window.location.href + "configure";

    if (isFullScreen) {
        editConfigUrl = window.location.href.split("?fullscreen=true")[0] + "configure";
    }

    html.push("<div class=\"button buttonEdit\">");
        html.push("<a id=\"refreshpipeline-" + c  + "\" href=\"" + editConfigUrl + "\" style=\"text-decoration:none;\">");
            html.push("<p class=\"buttonText\">Edit View Configuration</p>");
        html.push("</a>");
    html.push("</div>");

    var fullscreenMsg = "View Fullscreen";
    var fullscreenUrl = window.location.href + "?fullscreen=true";

    if (isFullScreen) {
        fullscreenMsg = "Exit Fullscreen";
        fullscreenUrl = window.location.href.split("?fullscreen=true")[0];
    }

    html.push("<div class=\"button buttonFullscreen\">");
        html.push("<a id=\"refreshpipeline-" + c  + "\" href=\"" + fullscreenUrl + "\" style=\"text-decoration:none;\">");
            html.push("<p class=\"buttonText\">" + fullscreenMsg + "</p>");
        html.push("</a>");
    html.push("</div>");
    return html.join("");
}

function generateDescription(data, task) {
    if (data.showDescription && task.description && task.description != "") {
        var html = ["<div class='infoPanelOuter'>"];
        html.push("<div class='infoPanel'><div class='infoPanelInner'>" + task.description.replace(/\r\n/g, '<br/>') + "</div></div>");
        html.push("</div>");
        return html.join("");
    }
}

function generateTestInfo(data, task) {
    if (data.showTestResults && task.testResults && task.testResults.length > 0) {
        var html = ["<div class='infoPanelOuter'>"];
        Q.each(task.testResults, function(i, analysis) {
            html.push("<div class='infoPanel'><div class='infoPanelInner'>");
                html.push("<a href=" + getLink(data,analysis.url) + ">" + analysis.name + "</a>");
                html.push("<table id='priority.summary' class='pane'>");
                html.push("<tbody>");
                    html.push("<tr>");
                        html.push("<td class='pane-header'>Total</td>");
                        html.push("<td class='pane-header'>Failures</td>");
                        html.push("<td class='pane-header'>Skipped</td>");
                    html.push("</tr>");
                html.push("</tbody>");
                html.push("<tbody>");
                    html.push("<tr>");
                        html.push("<td class='pane'>" + analysis.total + "</td>");
                        html.push("<td class='pane'>" + analysis.failed + "</td>");
                        html.push("<td class='pane'>" + analysis.skipped + "</td>");
                    html.push("</tr>");
                html.push("</tbody>");
                html.push("</table>");
            html.push("</div></div>");
        });
        html.push("</div>");
        return html.join("");
    }
}

function generateStaticAnalysisInfo(data, task) {
    if (data.showStaticAnalysisResults && task.staticAnalysisResults && task.staticAnalysisResults.length > 0) {
        var html = ["<div class='infoPanelOuter'>"];
        html.push("<div class='infoPanel'><div class='infoPanelInner'>");
            html.push("<table id='priority.summary' class='pane'>");
            html.push("<thead>");
                html.push("<tr>");
                    html.push("<td class='pane-header'>Warnings</td>");
                    html.push("<td class='pane-header' style='font-size: smaller; vertical-align: bottom;'>High</td>");
                    html.push("<td class='pane-header' style='font-size: smaller; vertical-align: bottom;'>Normal</td>");
                    html.push("<td class='pane-header' style='font-size: smaller; vertical-align: bottom;'>Low</td>");
                html.push("</tr>");
            html.push("</thead>");
            html.push("<tbody>");
            Q.each(task.staticAnalysisResults, function(i, analysis) {
                html.push("<tr>");
                    html.push("<td class='pane'><a href=" + getLink(data,analysis.url) + ">" + trimWarningsFromString(analysis.name) + "</a></td>");
                    html.push("<td class='pane' style='text-align: center;'>" + analysis.high + "</td>");
                    html.push("<td class='pane' style='text-align: center;'>" + analysis.normal + "</td>");
                    html.push("<td class='pane' style='text-align: center;'>" + analysis.low + "</td>");
                html.push("</tr>");
            });
            html.push("</tbody>");
            html.push("</table>");
        html.push("</div></div>");
        html.push("</div>");
        return html.join("");
    }
}

function trimWarningsFromString(label) {
    var offset = label.indexOf("Warnings");
    if (offset == -1) {
        return label;
    } else {
        return label.substring(0, offset).trim()
    }
}

function generatePromotionsInfo(data, task) {
    if (data.showPromotions && task.status.promoted && task.status.promotions && task.status.promotions.length > 0) {
        var html = ["<div class='infoPanelOuter'>"];
        Q.each(task.status.promotions, function(i, promo) {
            html.push("<div class='infoPanel'><div class='infoPanelInner'><div class='promo-layer'>");
            html.push("<img class='promo-icon' height='16' width='16' src='" + rootURL + promo.icon + "'/>");
            html.push("<span class='promo-name'><a href='" + getLink(data,task.link) + "promotion'>" + htmlEncode(promo.name) + "</a></span><br/>");
            if (promo.user != 'anonymous') {
                html.push("<span class='promo-user'>" + promo.user + "</span>");
            }
            html.push("<span class='promo-time'>" + formatDuration(promo.time) + "</span><br/>");
            if (promo.params.length > 0) {
                html.push("<br/>");
            }
            Q.each(promo.params, function (j, param) {
                html.push(param.replace(/\r\n/g, '<br/>') + "<br />");
            });
            html.push("</div></div></div>");
        });
        html.push("</div>");
        return html.join("");
    }
}

function generateChangeLog(changes) {
    var html = ['<div class="changes">'];
    html.push('<h1>Changes:</h1>');
    for (var i = 0; i < changes.length; i++) {
        html.push('<div class="change">');
        var change = changes[i];

        if (change.changeLink) {
            html.push('<a href="' + change.changeLink + '">');
        }

        html.push('<div class="change-commit-id">' + htmlEncode(change.commitId) + '</div>');

        if (change.changeLink) {
            html.push('</a>');
        }

        html.push('<div class="change-author">' + htmlEncode(change.author.name) + '</div>');

        html.push('<div class="change-message">' + change.message + '</div>');
        html.push('</div>');
    }
    html.push('</div>');
    return html.join("");
}

function generateAggregatedChangelog(stageChanges, aggregatedChangesGroupingPattern) {
    var html = [];
    html.push("<div class='aggregatedChangesPanelOuter'>");
    html.push("<div class='aggregatedChangesPanel'>");
    html.push("<div class='aggregatedChangesPanelInner'>");
    html.push("<b>Changes:</b>");
    html.push("<ul>");

    var changes = {};

    var unmatchedChangesKey = '';

    if (aggregatedChangesGroupingPattern) {
        var re = new RegExp(aggregatedChangesGroupingPattern);

        stageChanges.forEach(function(stageChange) {
            var matches = stageChange.message.match(re) || [unmatchedChangesKey];

            Q.unique(matches).forEach(function (match) {
                (changes[match] || (changes[match] = [])).push(stageChange);
            });
        });
    } else {
        changes[unmatchedChangesKey] = stageChanges;
    }

    var keys = Object.keys(changes).sort().filter(function(matchKey) {
        return matchKey !== unmatchedChangesKey;
    });

    keys.push(unmatchedChangesKey);

    keys.forEach(function(matchKey) {
        if (matchKey != unmatchedChangesKey) {
            html.push("<li class='aggregatedKey'><b>" + matchKey + "</b><ul>");
        }

        (changes[matchKey] || []).forEach(function (change) {
            html.push("<li>");
            html.push(change.message || "&nbsp;");
            html.push("</li>");
        });

        if (matchKey != unmatchedChangesKey) {
            html.push("</ul></li>");
        }
    });

    html.push("</ul>");
    html.push("</div>");
    html.push("</div>");
    html.push("</div>");

    return html.join("")
}

function getStageClassName(stagename) {
    return "stage_" + replace(stagename, " ", "_");
}

function getTaskId(taskname, count) {
    return "task-" + replace(replace(taskname, " ", "_"), "/", "_") + count;
}

function replace(string, replace, replaceWith) {
    var re = new RegExp(replace, 'g');
    return string.replace(re, replaceWith);
}


function formatDate(date, currentTime) {
    if (date != null) {
        return moment(date, "YYYY-MM-DDTHH:mm:ss").from(moment(currentTime, "YYYY-MM-DDTHH:mm:ss"))
    } else {
        return "";
    }
}

/**
 * Full credit for the 2 Date methods below to the author of the following article:
 * http://javascript.about.com/library/bldst.htm
 */
Date.prototype.stdTimezoneOffset = function() {
    var jan = new Date(this.getFullYear(), 0, 1);
    var jul = new Date(this.getFullYear(), 6, 1);
    return Math.max(jan.getTimezoneOffset(), jul.getTimezoneOffset());
}

Date.prototype.dst = function() {
    return this.getTimezoneOffset() < this.stdTimezoneOffset();
}

/**
 * For the 4 primary US timezones
 */
function getUSTimezone(timestamp, timezone) {
    var timezones = '{}';
    var today = new Date(timestamp);

    // Account for daylight savings time
    if (today.dst()) {
        timezones = JSON.parse('{"-07:00": "PDT", "-06:00": "MDT", "-05:00": "CDT","-04:00": "EDT"}');
    }
    else {
        timezones = JSON.parse('{"-08:00": "PST", "-07:00": "MST", "-06:00": "CST","-05:00": "EST"}');
    }

    // For other parts in the world
    if (timezones.hasOwnProperty(timezone) != true) {
        return timezone;
    }

    return timezones[timezone];
}

/**
 * Returns a human readable date string using the browsers time zone.
 */
function formatLongDate(timestamp) {
  if (timestamp != null) {
    var dateString = moment.unix(parseInt(timestamp) / 1000).format("ddd MMM Do YYYY h:mm:ss A Z");
    var timezoneString = getUSTimezone(parseInt(timestamp), dateString.split(' ')[6]);

    return dateString.split(' ').slice(0, 6).join(' ') + " " + timezoneString;
  }
  return "Never started";
}

/**
 * Returns a human readable duration string in Dd HH:MM:SS
 */
function formatLongDuration(ts) {
    if (ts > 0) {
        var timestamp = Math.floor(ts / 1000);
        var seconds = (timestamp % 60).toString();

        timestamp = Math.floor(timestamp / 60);
        var minutes = (timestamp % 60).toString();

        timestamp = Math.floor(timestamp / 60);
        var hours = (timestamp % 24).toString();

        timestamp = Math.floor(timestamp / 24);
        var days = timestamp.toString();

        if (hours.length == 1) {
            hours = "0" + hours;
        }

        if (minutes.length == 1) {
            minutes = "0" + minutes;
        }

        if (seconds.length == 1) {
            seconds = "0" + seconds;
        }

        return days + 'd ' + hours + ':' + minutes + ':' + seconds;
    }
    return "Never started";
}

function formatDuration(millis) {
    if (millis > 0) {
        var seconds = Math.floor(millis / 1000),
            minutes = Math.floor(seconds / 60),
            minstr,
            secstr;

        seconds = seconds % 60;

        if (minutes === 0){
            minstr = "";
        } else {
            minstr = minutes + " min ";
        }

        secstr = "" + seconds + " sec";

        return minstr + secstr;
    }
    return "0 sec";
}

function triggerManual(taskId, downstreamProject, upstreamProject, upstreamBuild, viewUrl) {
    var confirmManualStep = confirm("Are you sure you want to kick off this manual step?");
    if (!confirmManualStep) {
        console.info("Did not trigger manual step!");
        return;
    }

    Q("#manual-" + taskId).hide();
    var formData = {project: downstreamProject, upstream: upstreamProject, buildId: upstreamBuild},
        before;

    if (crumb.value !== null && crumb.value !== "") {
        console.info("Crumb found and will be added to request header");
        before = function(xhr){xhr.setRequestHeader(crumb.fieldName, crumb.value);}
    } else {
        console.info("Crumb not needed");
        before = function(xhr){}
    }

    Q.ajax({
        url: rootURL + "/" + viewUrl + 'api/manualStep',
        type: "POST",
        data: formData,
        beforeSend: before,
        timeout: 20000,
        async: true,
        success: function (data, textStatus, jqXHR) {
            console.info("Triggered build of " + downstreamProject + " successfully!");
        },
        error: function (jqXHR, textStatus, errorThrown) {
            window.alert("Could not trigger build! error: " + errorThrown + " status: " + textStatus);
        }
    });

    refreshFn(false);
}

function triggerRebuild(taskId, project, buildId, viewUrl) {
    Q("#rebuild-" + taskId).hide();
    var formData = {project: project, buildId: buildId};

    var before;
    if (crumb.value != null && crumb.value != "") {
        console.info("Crumb found and will be added to request header");
        before = function(xhr){xhr.setRequestHeader(crumb.fieldName, crumb.value);}
    } else {
        console.info("Crumb not needed");
        before = function(xhr){}
    }

    Q.ajax({
        url: rootURL + "/" + viewUrl + 'api/rebuildStep',
        type: "POST",
        data: formData,
        beforeSend: before,
        timeout: 20000,
        success: function (data, textStatus, jqXHR) {
            console.info("Triggered rebuild of " + project + " successfully!")
        },
        error: function (jqXHR, textStatus, errorThrown) {
            window.alert("Could not trigger rebuild! error: " + errorThrown + " status: " + textStatus)
        }
    });
}

function triggerParameterizedBuild(url, taskId) {
    console.info("Job is parameterized");
    openNewTabInBackground(rootURL + "/" + url + 'build?delay=0sec');
}

function triggerBuild(url, taskId) {
    var before;
    if (crumb.value != null && crumb.value != "") {
        console.info("Crumb found and will be added to request header");
        before = function(xhr){xhr.setRequestHeader(crumb.fieldName, crumb.value);}
    } else {
        console.info("Crumb not needed");
        before = function(xhr){}
    }

    Q.ajax({
        url: rootURL + "/" + url + 'build?delay=0sec',
        type: "POST",
        beforeSend: before,
        timeout: 20000,
        success: function (data, textStatus, jqXHR) {
            console.info("Triggered build of " + taskId + " successfully!")
            refreshFn(true);
        },
        error: function (jqXHR, textStatus, errorThrown) {
            window.alert("Could not trigger build! error: " + errorThrown + " status: " + textStatus)
        }
    });
}
 
function refreshFn(clearToggleStates) {
    if (clearToggleStates) {
        // Clear all toggle states
        sessionStorage.toggleStates = JSON.stringify({});    
    }

    // CLear all saved pipeline
    sessionStorage.pipelineStageIdMap = JSON.stringify({});

    pipelineutils.updatePipelines(
        pipelineutilsData[0],
        pipelineutilsData[1],
        pipelineutilsData[2],
        pipelineutilsData[3],
        pipelineutilsData[4],
        pipelineutilsData[5],
        pipelineutilsData[6],
        pipelineutilsData[7],
        pipelineutilsData[8],
        pipelineutilsData[9],
        pipelineutilsData[10]
    );
}

function htmlEncode(html) {
    return document.createElement('a')
        .appendChild(document.createTextNode(html))
        .parentNode.innerHTML
        .replace(/\n/g, '<br/>');
}

function getStageId(name, count) {
    var re = new RegExp(' ', 'g');
    return name.replace(re, '_') + "_" + count;
}

function equalheight(container) {
    var currentTallest = 0,
        currentRowStart = 0,
        rowDivs = new Array(),
        $el,
        topPosition = 0;

    Q(container).each(function () {

        $el = Q(this);
        Q($el).height('auto');
        topPosition = $el.position().top;

        if (currentRowStart != topPosition) {
            rowDivs.length = 0; // empty the array
            currentRowStart = topPosition;
            currentTallest = $el.height() + 2;
            rowDivs.push($el);
        } else {
            rowDivs.push($el);
            currentTallest = (currentTallest < $el.height() + 2) ? ($el.height() + 2) : (currentTallest);
        }
        for (currentDiv = 0; currentDiv < rowDivs.length; currentDiv++) {
            rowDivs[currentDiv].height(currentTallest);
        }
    });
}

/**
 * Load all artifacts for a build.
 */
function loadBuildArtifacts(buildId) {
    var savedValues = JSON.parse(sessionStorage.savedPipelineArtifacts);    

    if (savedValues.hasOwnProperty(buildId)) {
        return savedValues[buildId];
    }

    return "No artifacts found";
}

/**
 * Get all artifacts for a build.
 */
function getBuildArtifacts(jobName, buildNum, buildId) {
    if (!isNullOrEmpty(buildNum)) {
        // If there are no artifacts and we previously checked this url, don't check it again
        var markedUrls = JSON.parse(sessionStorage.markedUrls);
        if (markedUrls.hasOwnProperty(rootURL + "/job/" + jobName + "/" + buildNum + "/api/json?tree=artifacts[*]")) {
            return;
        }

        Q.ajax({
            url: rootURL + "/job/" + jobName + "/" + buildNum + "/api/json?tree=artifacts[*]",
            type: "GET",
            dataType: 'json',
            async: true,
            cache: true,
            timeout: 20000,
            success: function (json) {
                getBuildArtifactData(this.url, jobName, buildNum, buildId, json.artifacts);
            },
            error: function (xhr, status, error) {
            }
        })
    }
}

/**
 * Callback function to get an artifacts data.
 */
function getBuildArtifactData(url, jobName, buildNum, buildId, data) {
    var artifacts = [];

    if (data.length > 0) {
        for (var i=0; i<data.length; i++) {
            artifacts.push(data[i].fileName);
        }
    }

    if (artifacts.length > 0) {
        for (var i=0; i<artifacts.length; i++) {
            Q.ajax({
                url: rootURL + "/job/" + jobName + "/" + buildNum + "/artifact/" + artifacts[i],
                type: "GET",
                async: true,
                cache: true,
                timeout: 20000,
                success: function (json) {
                    getBuildArtifactLinks(this.url, json, buildId);
                },
                error: function (xhr, status, error) {
                }
            })
        }
    }

    // Mark this url so we don't check it again
    var markedUrls = JSON.parse(sessionStorage.markedUrls);
    markedUrls[url] = "true";
    sessionStorage.markedUrls = JSON.stringify(markedUrls);
}

/**
 * Callback function to generate a link to a specific build artifact.
 */
function getBuildArtifactLinks(url, json, buildId) {
    var savedValues = JSON.parse(sessionStorage.savedPipelineArtifacts);
    var ele = document.getElementById(buildId);

    if (ele != null) {
        var artifact = url.split("/artifact/")[1];

        var eleString = "<a href=\"" + url + "\" class=\"displayTableEntryLink\">" + artifact + 
                        "<span class=\"tooltip hoverText\">" + json + "</span></a>";

        if (ele.innerHTML != "No artifacts found") {
            ele.innerHTML += ", " + eleString;
        } else {
            ele.innerHTML = eleString;
        }

        savedValues[buildId] = ele.innerHTML;
        sessionStorage.savedPipelineArtifacts = JSON.stringify(savedValues);
    }
}

/**
 * Get custom pipeline status
 */
function getCustomPipelineBuildStatus(displayArgs, pipeline, jobName, buildNum, allStagesComplete) {
    for (var mainProject in displayArgs) {
        if (mainProject == jobName) {
            // Check for global display arguments
            if (!displayArgs[mainProject].hasOwnProperty("PipelineBuildStatus")) {
                return;
            }

            // Pipeline is still running to set the status to be running
            if (!allStagesComplete) {
                // Update pipeline build status to finalStatus
                var id = jobName + "-" + buildNum + "-status";
                var ele = document.getElementById(id);
                ele.className = "circle_header circle_RUNNING build_circle";
                return;
            } else {
                // Check that all the user defined jobs are successful
                var finalStatus = "";
                for (var i = 0; i < pipeline.stages.length; i++) {
                    stage = pipeline.stages[i];

                    var projects = displayArgs[mainProject].PipelineBuildStatus;
                    while (projects != "") {
                        var project = projects.split(",")[0];

                        if (stage.name == project) {
                            stageStatus = stage.tasks[0].status.type;

                            if (stageStatus == "FAILED" || stageStatus == "CANCELLED" || stageStatus == "IDLE") {

                                var id = jobName + "-" + buildNum + "-status";
                                var ele = document.getElementById(id);
                                ele.className = "circle_header circle_FAILED build_circle";
                                return;
                            }
                            if (stageStatus == "SUCCESS") {
                                finalStatus = "SUCCESS";
                            }
                            break;
                        }
                        projects = projects.split(",").slice(1).join(",");
                    }
                }
                if (finalStatus != "") {
                    // Update pipeline build status to finalStatus
                    var id = jobName + "-" + buildNum + "-status";
                    var ele = document.getElementById(id);
                    ele.className = "circle_header circle_" + finalStatus + " build_circle"; 
                }
            }
        }
    }
}

/**
 * Generate an table of specified display values
 */
function generateGlobalDisplayValueTable(displayArgs, pipelineName, pipelineNum) {
    var retVal = "";

    for (var mainProject in displayArgs) {
        if (mainProject == pipelineName) {
            // Check for global display arguments
            if (!displayArgs[mainProject].hasOwnProperty("Global")) {
                return "";
            }
            var mainProjectDisplayConfig = displayArgs[mainProject].Global;

            for (var displayKey in mainProjectDisplayConfig) {
                var displayKeyConfig = mainProjectDisplayConfig[displayKey];
                var projectName = "";
                if (displayKeyConfig.hasOwnProperty("projectName")) {
                    projectName = displayKeyConfig.projectName;
                }

                var id = mainProject + "-" + getStageId(displayKey, pipelineNum) + "-" + projectName;
                retVal += "<tr class=\"displayTableTr\"><th class=\"displayTableTh\">" + displayKey + "</th>" + 
                          "<td id=\"" + id + "\" class=\"displayTableTd\">Value not found across pipeline</td></tr>";    
            }    
        }
    }
    return retVal;
}

/**
 * Load the displayed values
 */
function loadGlobalDisplayValues(displayArgs, pipelineName, pipelineNum, savedPipelineDisplayValues) {
    var retVal = "";

    for (var mainProject in displayArgs) {
        if (mainProject == pipelineName) {
            // Check for global display arguments
            if (!displayArgs[mainProject].hasOwnProperty("Global")) {
                return "";
            }
            var mainProjectDisplayConfig = displayArgs[mainProject].Global;

            for (var displayKey in mainProjectDisplayConfig) {
                var displayKeyConfig = mainProjectDisplayConfig[displayKey];
                var projectName = "";
                if (displayKeyConfig.hasOwnProperty("projectName")) {
                    projectName = displayKeyConfig.projectName;
                }

                var id = mainProject + "-" + getStageId(displayKey, pipelineNum) + "-" + projectName;

                if (savedPipelineDisplayValues.hasOwnProperty(id)) {
                    retVal += "<tr class=\"displayTableTr\">" + 
                              "<th class=\"displayTableTh\">" + displayKey + "</th>" +
                              "<td id=\"" + id + "\" class=\"displayTableTd\">" + savedPipelineDisplayValues[id] +
                              "</td></tr>";
                } else {
                    retVal += "<tr class=\"displayTableTr\">" + 
                              "<th class=\"displayTableTh\">" + displayKey + "</th>" +
                              "<td id=\"" + id + "\" class=\"displayTableTd\">Value not found across pipeline</td>" +
                              "</tr>";
                }
            }
        }
    }
    return retVal;
}

/**
 * Retrieve desired values from any projects along a pipeline
 */
function getGlobalDisplayValues(displayArgs, pipeline, pipelineName, pipelineNum) {
    var stage;
    var projectNameIdMap = {};
    var updateString = "";
    var retVal = "";
    var savedValues = JSON.parse(sessionStorage.savedPipelineDisplayValues);
    var previousDisplayArgConfig = JSON.parse(sessionStorage.previousDisplayArgConfig);
    var configNotChanged = _.isEqual(previousDisplayArgConfig, displayArgs);

    // Get a mapping of project names to project build ids
    for (var j = 0; j < pipeline.stages.length; j++) {
        stage = pipeline.stages[j];
        projectNameIdMap[stage.name] = stage.tasks[0].buildId;
    }

    for (var mainProject in displayArgs) {
        if (mainProject == pipelineName) {
            // Check for global display arguments
            if (!displayArgs[mainProject].hasOwnProperty("Global")) {
                return;
            }
            var mainProjectDisplayConfig = displayArgs[mainProject].Global;

            for (var displayKey in mainProjectDisplayConfig) {
                var displayKeyConfig = mainProjectDisplayConfig[displayKey];
                var projectName, filePath, artifactName, envName, paramName, fromConsole, grepPattern;
                projectName = filePath = artifactName = envName = paramName = fromConsole = grepPattern = "";

                if (displayKeyConfig.hasOwnProperty("projectName")) {
                    projectName = displayKeyConfig.projectName;

                    // Do not search for a previously found value
                    var id = pipelineName + "-" + getStageId(displayKey, pipelineNum) + "-" + projectName;
                    if (savedValues.hasOwnProperty(id) && configNotChanged) {
                        continue;
                    }
                    if (projectNameIdMap.hasOwnProperty(projectName) == false) {
                        continue;
                    }

                    if (displayKeyConfig.hasOwnProperty("filePath")) {
                        filePath = displayKeyConfig.filePath;
                    }
                    if (displayKeyConfig.hasOwnProperty("artifactName")) {
                        artifactName = displayKeyConfig.artifactName;
                    }
                    if (displayKeyConfig.hasOwnProperty("envName")) {
                        envName = displayKeyConfig.envName;
                    }
                    if (displayKeyConfig.hasOwnProperty("paramName")) {
                        paramName = displayKeyConfig.paramName;
                    }
                    if (displayKeyConfig.hasOwnProperty("fromConsole")) {
                        fromConsole = displayKeyConfig.fromConsole;
                    }

                    // We expect one of the following to be populated so we know where to look
                    if (filePath == "" && artifactName == "" && envName == "" && paramName == "" && fromConsole == "") {
                        continue;
                    }

                    var url = "";
                    if (artifactName != "") {
                        url = "/job/" + projectName + "/" + projectNameIdMap[projectName] + "/artifact/" + artifactName;
                        if (projectNameIdMap[projectName] == null) {
                            return;
                        }
                    }
                    if (filePath != "") {
                        url = "/job/" + projectName + "/ws/" + filePath;
                    }
                    if (envName != "" || paramName != "") {
                        url = "/job/" + projectName + "/" + projectNameIdMap[projectName] + "/injectedEnvVars/api/json";
                        if (projectNameIdMap[projectName] == null) {
                            return;
                        }
                    }
                    if (fromConsole == "true" || fromConsole == true) {
                        url = "/job/" + projectName + "/" + projectNameIdMap[projectName] + "/consoleText";
                        if (projectNameIdMap[projectName] == null) {
                            return;
                        }
                    }

                    // In the event that somehow we fail to create a URL
                    if (url == "") {
                        continue;
                    }

                    var markedUrls = JSON.parse(sessionStorage.markedUrls);
                    if (markedUrls.hasOwnProperty(rootURL + url)) {
                        continue;
                    }

                    Q.ajax({
                        url: rootURL + url,
                        type: "GET",
                        async: true,
                        cache: true,
                        timeout: 20000,
                        success: function(data) {
                            updateGlobalDisplayValues(data, this.url, displayArgs, pipelineName, pipelineNum);
                        },
                        error: function (xhr, status, error) {
                            var markedUrls = JSON.parse(sessionStorage.markedUrls);
                            markedUrls[this.url] = "true";
                            sessionStorage.markedUrls = JSON.stringify(markedUrls);
                        }
                    })
                }
            }
        }
    }
}

 /**
  * Callback function to update the global display values
  */
function updateGlobalDisplayValues(data, url, displayArgs, pipelineName, pipelineNum) {
    var projectName = (url.split("/job/")[1]).split("/")[0];

    // Environment Variable / Parameter
    if (url.indexOf("/injectedEnvVars/") != -1) {
        for (var mainProject in displayArgs) {
            if (mainProject == pipelineName) {
                // Check for global display arguments
                if (!displayArgs[mainProject].hasOwnProperty("Global")) {
                    return;
                }
                var mainProjectDisplayConfig = displayArgs[mainProject].Global;

                for (var displayKey in mainProjectDisplayConfig) {
                    var displayKeyConfig = mainProjectDisplayConfig[displayKey];
                    var envName = "";

                    if (displayKeyConfig.hasOwnProperty("projectName") && displayKeyConfig.projectName == projectName) {
                        if (displayKeyConfig.hasOwnProperty("envName") || displayKeyConfig.hasOwnProperty("paramName")) {
                            envName = displayKeyConfig.hasOwnProperty("envName") ? displayKeyConfig.envName : displayKeyConfig.paramName;
                            
                            if (data.hasOwnProperty("envMap")) {
                                var envMap = data.envMap;

                                if (envMap.hasOwnProperty(envName)) {
                                    var id = pipelineName + "-" + getStageId(displayKey, pipelineNum) + "-" + projectName;
                                    var ele = document.getElementById(id);

                                    if (displayKeyConfig.hasOwnProperty("grepPattern")) {
                                        var grepPattern = displayKeyConfig.grepPattern;
                                        var grepFlag = displayKeyConfig.hasOwnProperty("grepFlag") ? displayKeyConfig.grepFlag : 'g';
                                        ele.innerHTML = grepRegexp(grepPattern, grepFlag, envMap[envName]);
                                    } else {
                                        ele.innerHTML = envMap[envName];    
                                    }

                                    var savedValues = JSON.parse(sessionStorage.savedPipelineDisplayValues);
                                    savedValues[id] = ele.innerHTML;
                                    sessionStorage.savedPipelineDisplayValues = JSON.stringify(savedValues);
                                }
                            }
                        }
                    }
                }
            }
        }
    // Console Log
    } else if (url.indexOf("/consoleText") != -1) {
        for (var mainProject in displayArgs) {
            if (mainProject == pipelineName) {
                // Check for global display arguments
                if (!displayArgs[mainProject].hasOwnProperty("Global")) {
                    return;
                }
                var mainProjectDisplayConfig = displayArgs[mainProject].Global;

                for (var displayKey in mainProjectDisplayConfig) {
                    var displayKeyConfig = mainProjectDisplayConfig[displayKey];

                    if (displayKeyConfig.hasOwnProperty("projectName") && displayKeyConfig.projectName == projectName) {
                        if (displayKeyConfig.hasOwnProperty("fromConsole") && 
                            (displayKeyConfig.fromConsole == "true" || displayKeyConfig.fromConsole == true)) {
                            var toolTipData = data;

                            // JSON files return javascript objects which must be stringified
                            if (data !== null && typeof data === 'object') {
                                toolTipData = JSON.stringify(data).replace(/-/g, '&#x2011;');
                            } else {
                                toolTipData = data.replace(/-/g, '&#x2011;');
                            }

                            if (displayKeyConfig.hasOwnProperty("grepPattern")) {
                                var grepPattern = displayKeyConfig.grepPattern;
                                var grepFlag = displayKeyConfig.hasOwnProperty("grepFlag") ? displayKeyConfig.grepFlag : 'g';
                                toolTipData = grepRegexp(grepPattern, grepFlag, toolTipData);
                            }
                            toolTipData = toolTipData.replace(/(?:\r\n|\r|\n)/g, '<br/>');

                            var id = pipelineName + "-" + getStageId(displayKey, pipelineNum) + "-" + projectName;
                            var ele = document.getElementById(id);

                            if (displayKeyConfig.hasOwnProperty("useLink") && 
                                (displayKeyConfig.useLink == "true" || displayKeyConfig.useLink == true)) {

                                ele.innerHTML = "<a href=\"" + url + "\" class=\"displayTableEntryLink\">" + 
                                                url.split("/job/")[1] + "<span class=\"tooltip hoverText\">" + toolTipData +
                                                "</span></a>";
                            } else {
                                ele.innerHTML = toolTipData;
                                redrawConnections();
                            }

                            var savedValues = JSON.parse(sessionStorage.savedPipelineDisplayValues);
                            savedValues[id] = ele.innerHTML;
                            sessionStorage.savedPipelineDisplayValues = JSON.stringify(savedValues);
                        }
                    }
                }
            }
        }
    // File Path or Artifact Name
    } else {
        var file;
        var propertyType;

        if (url.indexOf("/ws/") != -1) {
            file = url.split("/ws/")[1];
            propertyType = "filePath";
        } else {
            file = url.split("/artifact/")[1];
            propertyType = "artifactName";
        }

        for (var mainProject in displayArgs) {
            if (mainProject == pipelineName) {
                // Check for global display arguments
                if (!displayArgs[mainProject].hasOwnProperty("Global")) {
                    return;
                }
                var mainProjectDisplayConfig = displayArgs[mainProject].Global;

                for (var displayKey in mainProjectDisplayConfig) {
                    var displayKeyConfig = mainProjectDisplayConfig[displayKey];

                    if (displayKeyConfig.hasOwnProperty("projectName") && displayKeyConfig.projectName == projectName) {
                        if (displayKeyConfig.hasOwnProperty(propertyType) && displayKeyConfig[propertyType] == file) {
                            var toolTipData = data;

                            // JSON files return javascript objects which must be stringified
                            if (data !== null && typeof data === 'object') {
                                toolTipData = JSON.stringify(data).replace(/-/g, '&#x2011;');
                            } else {
                                toolTipData = data.replace(/-/g, '&#x2011;');
                            }

                            if (displayKeyConfig.hasOwnProperty("grepPattern")) {
                                var grepPattern = displayKeyConfig.grepPattern;
                                var grepFlag = displayKeyConfig.hasOwnProperty("grepFlag") ? displayKeyConfig.grepFlag : 'g';
                                toolTipData = grepRegexp(grepPattern, grepFlag, toolTipData);
                            }
                            toolTipData = toolTipData.replace(/(?:\r\n|\r|\n)/g, '<br/>');

                            var id = pipelineName + "-" + getStageId(displayKey, pipelineNum) + "-" + projectName;
                            var ele = document.getElementById(id);

                            if (displayKeyConfig.hasOwnProperty("useLink") && 
                                (displayKeyConfig.useLink == "true" || displayKeyConfig.useLink == true)) {
                                ele.innerHTML = "<a href=\"" + url + "\" class=\"displayTableEntryLink\">" +
                                                url.split("/job/")[1] + "<span class=\"tooltip hoverText\">" + toolTipData +
                                                "</span></a>";    
                            } else {
                                ele.innerHTML = toolTipData;
                                redrawConnections();
                            }

                            var savedValues = JSON.parse(sessionStorage.savedPipelineDisplayValues);
                            savedValues[id] = ele.innerHTML;
                            sessionStorage.savedPipelineDisplayValues = JSON.stringify(savedValues);
                        }
                    }
                }
            }
        }
    }
}

/**
 * Generate an table of stage specific display values
 */
function generateStageDisplayValueTable(displayArgs, pipelineName, stageName, stageBuildNum, stageId) {
    var retVal = "";

    for (var mainProject in displayArgs) {
        if (mainProject == pipelineName) {
            // Check for stage specific display arguments
            if (!displayArgs[mainProject].hasOwnProperty(stageName)) {
                return "";
            }
            var mainProjectDisplayConfig = (displayArgs[mainProject])[stageName];
            var re = new RegExp(' ', 'g');

            for (var displayKey in mainProjectDisplayConfig) {
                retVal += "<tr class=\"hoverRow\"><th class=\"hoverTableTh\">" + displayKey + ":</th>";
                retVal += "<td id=\"" + stageId + "-" + stageBuildNum + "-" + displayKey.replace(re, '_') 
                          + "\" class=\"hoverTableTd\">Value not found across pipeline</td></tr>";  
            }    
        }
    }
    return retVal;
}

/**
 * Retrieve desired values for a specific project along a pipeline
 */
function getStageDisplayValues(displayArgs, pipelineName, stageName, stageBuildNum, stageId) {
    var previousDisplayArgConfig = JSON.parse(sessionStorage.previousDisplayArgConfig);
    var savedStageDisplayValues = JSON.parse(sessionStorage.savedStageDisplayValues);
    var re = new RegExp(' ', 'g');
    var configNotChanged = _.isEqual(previousDisplayArgConfig, displayArgs);

    for (var mainProject in displayArgs) {
        if (mainProject == pipelineName) {
            // Check for stage specific display arguments
            if (!displayArgs[mainProject].hasOwnProperty(stageName)) {
                return;
            }
            var mainProjectDisplayConfig = (displayArgs[mainProject])[stageName];

            for (var displayKey in mainProjectDisplayConfig) {

                var saveId = stageName + "-" + stageBuildNum + "-" + displayKey.replace(re, '_');
                if (savedStageDisplayValues.hasOwnProperty(saveId) && configNotChanged) {
                    var id = stageId + "-" + stageBuildNum + "-" + displayKey.replace(re, '_');
                    var ele = document.getElementById(id);
                    ele.innerHTML = savedStageDisplayValues[saveId];
                    continue;
                }

                var displayKeyConfig = mainProjectDisplayConfig[displayKey];
                var filePath, artifactName, envName, paramName, fromConsole, grepPattern;
                filePath = artifactName = envName = paramName = fromConsole = grepPattern = "";

                if (displayKeyConfig.hasOwnProperty("filePath")) {
                    filePath = displayKeyConfig.filePath;
                }
                if (displayKeyConfig.hasOwnProperty("artifactName")) {
                    artifactName = displayKeyConfig.artifactName;
                }
                if (displayKeyConfig.hasOwnProperty("envName")) {
                    envName = displayKeyConfig.envName;
                }
                if (displayKeyConfig.hasOwnProperty("paramName")) {
                    paramName = displayKeyConfig.paramName;
                }
                if (displayKeyConfig.hasOwnProperty("fromConsole")) {
                    fromConsole = displayKeyConfig.fromConsole;
                }

                // We expect one of the following to be populated so we know where to look
                if (filePath == "" && artifactName == "" && envName == "" && paramName == "" && fromConsole == "") {
                    continue;
                }

                var url = "";
                if (artifactName != "") {
                    url = "/job/" + stageName + "/" + stageBuildNum + "/artifact/" + artifactName;
                    if (stageBuildNum == null) {
                        return;
                    }
                }
                if (filePath != "") {
                    url = "/job/" + stageName + "/ws/" + filePath;
                }
                if (envName != "" || paramName != "") {
                    url = "/job/" + stageName + "/" + stageBuildNum + "/injectedEnvVars/api/json";
                    if (stageBuildNum == null) {
                        return;
                    }
                }
                if (fromConsole == "true" || fromConsole == true) {
                    url = "/job/" + stageName + "/" + stageBuildNum + "/consoleText";
                    if (stageBuildNum == null) {
                        return;
                    }
                }

                // In the event that somehow we fail to create a URL
                if (url == "") {
                    continue;
                }

                var markedUrls = JSON.parse(sessionStorage.markedUrls);
                if (markedUrls.hasOwnProperty(rootURL + url)) {
                    continue;
                }

                Q.ajax({
                    url: rootURL + url,
                    type: "GET",
                    async: true,
                    cache: true,
                    timeout: 20000,
                    success: function(data) {
                        updateStageDisplayValues(this.url, data, displayArgs, pipelineName, stageName, 
                            stageBuildNum, stageId);
                    },
                    error: function (xhr, status, error) {
                        var markedUrls = JSON.parse(sessionStorage.markedUrls);
                        markedUrls[this.url] = "true";
                        sessionStorage.markedUrls = JSON.stringify(markedUrls);
                    }
                })
            }
        }
    }
}

 /**
  * Callback function to update the stage specific display values
  */
function updateStageDisplayValues(url, data, displayArgs, pipelineName, stageName, stageBuildNum, stageId) {
    var projectName = (url.split("/job/")[1]).split("/")[0];
    var re = new RegExp(' ', 'g');

    // Environment Variable / Parameter
    if (url.indexOf("/injectedEnvVars/") != -1) {
        for (var mainProject in displayArgs) {
            if (mainProject == pipelineName) {
                // Check for stage specific display arguments
                if (!displayArgs[mainProject].hasOwnProperty(stageName)) {
                    return;
                }
                var mainProjectDisplayConfig = (displayArgs[mainProject])[stageName];

                for (var displayKey in mainProjectDisplayConfig) {
                    var displayKeyConfig = mainProjectDisplayConfig[displayKey];
                    var envName = "";

                    if (displayKeyConfig.hasOwnProperty("envName") || displayKeyConfig.hasOwnProperty("paramName")) {
                        envName = displayKeyConfig.hasOwnProperty("envName") ? displayKeyConfig.envName : displayKeyConfig.paramName;
                        
                        if (data.hasOwnProperty("envMap")) {
                            var envMap = data.envMap;

                            if (envMap.hasOwnProperty(envName)) {
                                var id = stageId + "-" + stageBuildNum + "-" + displayKey.replace(re, '_');
                                var ele = document.getElementById(id);

                                if (displayKeyConfig.hasOwnProperty("grepPattern")) {
                                    var grepPattern = displayKeyConfig.grepPattern;
                                    var grepFlag = displayKeyConfig.hasOwnProperty("grepFlag") ? displayKeyConfig.grepFlag : 'g';
                                    ele.innerHTML = grepRegexp(grepPattern, grepFlag, envMap[envName]);
                                } else {
                                    ele.innerHTML = envMap[envName];    
                                }

                                var saveId = stageName + "-" + stageBuildNum + "-" + displayKey.replace(re, '_');
                                var savedValues = JSON.parse(sessionStorage.savedStageDisplayValues);
                                savedValues[saveId] = ele.innerHTML;
                                sessionStorage.savedStageDisplayValues = JSON.stringify(savedValues);
                            }
                        }
                    }
                }
            }
        }
    // Console Log
    } else if (url.indexOf("/consoleText") != -1) {
        for (var mainProject in displayArgs) {
            if (mainProject == pipelineName) {
                // Check for stage specific display arguments
                if (!displayArgs[mainProject].hasOwnProperty(stageName)) {
                    return;
                }
                var mainProjectDisplayConfig = (displayArgs[mainProject])[stageName];

                for (var displayKey in mainProjectDisplayConfig) {
                    var displayKeyConfig = mainProjectDisplayConfig[displayKey];

                    if (displayKeyConfig.hasOwnProperty("fromConsole") && (displayKeyConfig.fromConsole == "true" || displayKeyConfig.fromConsole == true)) {
                        var toolTipData = data.replace(/-/g, '&#x2011;');

                        if (displayKeyConfig.hasOwnProperty("grepPattern")) {
                            var grepPattern = displayKeyConfig.grepPattern;
                            var grepFlag = displayKeyConfig.hasOwnProperty("grepFlag") ? displayKeyConfig.grepFlag : 'g';
                            toolTipData = grepRegexp(grepPattern, grepFlag, toolTipData);
                        }
                        toolTipData = toolTipData.replace(/(?:\r\n|\r|\n)/g, '<br/>');

                        var id = stageId + "-" + stageBuildNum + "-" + displayKey.replace(re, '_');
                        var ele = document.getElementById(id);
                        ele.innerHTML = toolTipData;

                        var saveId = stageName + "-" + stageBuildNum + "-" + displayKey.replace(re, '_');
                        var savedValues = JSON.parse(sessionStorage.savedStageDisplayValues);
                        savedValues[saveId] = ele.innerHTML;
                        sessionStorage.savedStageDisplayValues = JSON.stringify(savedValues);
                    }
                }
            }
        }
    // File Path or Artifact Name
    } else {
        var file;
        var propertyType;

        if (url.indexOf("/ws/") != -1) {
            file = url.split("/ws/")[1];
            propertyType = "filePath";
        } else {
            file = url.split("/artifact/")[1];
            propertyType = "artifactName";
        }

        for (var mainProject in displayArgs) {
            if (mainProject == pipelineName) {
                // Check for stage specific display arguments
                if (!displayArgs[mainProject].hasOwnProperty(stageName)) {
                    return;
                }
                var mainProjectDisplayConfig = (displayArgs[mainProject])[stageName];

                for (var displayKey in mainProjectDisplayConfig) {
                    var displayKeyConfig = mainProjectDisplayConfig[displayKey];

                    if (displayKeyConfig.hasOwnProperty(propertyType) && displayKeyConfig[propertyType] == file) {
                        var toolTipData = data.replace(/-/g, '&#x2011;');

                        if (displayKeyConfig.hasOwnProperty("grepPattern")) {
                            var grepPattern = displayKeyConfig.grepPattern;
                            var grepFlag = displayKeyConfig.hasOwnProperty("grepFlag") ? displayKeyConfig.grepFlag : 'g';
                            toolTipData = grepRegexp(grepPattern, grepFlag, toolTipData);
                        }
                        toolTipData = toolTipData.replace(/(?:\r\n|\r|\n)/g, '<br/>');

                        var id = stageId + "-" + stageBuildNum + "-" + displayKey.replace(re, '_');
                        var ele = document.getElementById(id);
                        ele.innerHTML = toolTipData;

                        var saveId = stageName + "-" + stageBuildNum + "-" + displayKey.replace(re, '_');
                        var savedValues = JSON.parse(sessionStorage.savedStageDisplayValues);
                        savedValues[saveId] = ele.innerHTML;
                        sessionStorage.savedStageDisplayValues = JSON.stringify(savedValues);
                    }
                }
            }
        }
    }
}

/**
 * Grep regexp method.
 */
function grepRegexp(grepPattern, grepFlag, data) {
    var expression = grepPattern;

    if (expression.charAt(0) == "/" && expression.charAt(expression.length - 1) == "/") {
        expression = expression.substring(1, expression.length - 1);
    }

    var regex = new RegExp(expression, grepFlag);
    var match;
    var results = [];

    while (match = regex.exec(data)) {
        results.push(match[0]);
    }
    return results.join("\n");
}

/**
 * Load the stages that failed on a blocking call.
 */
function loadFailedOnBlockStages(pipeline, i) {
    var pipelineNum = pipeline.version.substring(1);
    var blockedOnFailedMap = JSON.parse(sessionStorage.blockedOnFailedMap);
    var failedOnBlockingJobs = blockedOnFailedMap[pipeline.stages[0].name + "-" + pipelineNum];

    // No point iterating through the pipeline if there is no stage that failed on a blocking call
    if (JSON.stringify(failedOnBlockingJobs) == JSON.stringify({})) {
        return;
    }

    for (var j = 0; j < pipeline.stages.length - 1; j++) {
        var stage = pipeline.stages[j];

        if (failedOnBlockingJobs.hasOwnProperty(stage.name)) {
            var ele = document.getElementById(getStageId(stage.id + "", i));
            if (ele != null) {
               ele.className = "circle circle_FAILED_ON_BLOCK";
               ele.innerHTML = ele.innerHTML.replace("FAILED", "FAILED (on blocking call)");
            }
        }
    }
}

/**
 * Mark the stages that failed on a blocking call.
 */
function updateFailedOnBlockStages(pipeline, i) {
    var blockedOnFailedMap = JSON.parse(sessionStorage.blockedOnFailedMap);
    var pipelineNum = pipeline.version.substring(1);
    var failedOnBlockingJobs = {};

    for (var j = 0; j < pipeline.stages.length - 1; j++) {
        var stage = pipeline.stages[j];
        var ele = document.getElementById(getStageId(stage.id + "", i));
        var downstreamStages = stage.downstreamStages;
        var downstreamStageIds = stage.downstreamStageIds;
        var blockingJobs = stage.blockingJobs;

        var stageNum = stage.tasks[0].buildId;

        if (downstreamStages.length == 0) {
            continue;
        }

        if (stage.tasks[0].status.type == "FAILED") {
            for (var k = 0; k < downstreamStages.size(); k++) {
                if (blockingJobs.indexOf(downstreamStages[k]) != -1) {
                    var downstreamEle = document.getElementById(getStageId(downstreamStageIds[k] + "", i));
                    if (downstreamEle != null) {
                        if (downstreamEle.className == "circle circle_FAILED" || downstreamEle.className == "circle circle_CANCELLED") {
                            ele.className = "circle circle_FAILED_ON_BLOCK";
                            ele.innerHTML = ele.innerHTML.replace("FAILED", "FAILED (due to blocking call)");
                            failedOnBlockingJobs[stage.name] = "true";
                        }
                    }
                }
            }
        }

        blockedOnFailedMap[pipeline.stages[0].name + "-" + pipelineNum] = failedOnBlockingJobs;
        sessionStorage.blockedOnFailedMap = JSON.stringify(blockedOnFailedMap);
    }
}

/**
 * Show/hides the legend
 */
function toggleLegend(jobName, buildNum, showLegend) {
    var legendSuffix = jobName + "-" + buildNum;
    if (showLegend) {
        instance.show("b-" + legendSuffix);
        instance.show("nb-" + legendSuffix);
        instance.show("nbc-" + legendSuffix);
        instance.show("bc-" + legendSuffix);
        instance.show("d-" + legendSuffix);
    } else {
        instance.hide("b-" + legendSuffix);
        instance.hide("nb-" + legendSuffix);
        instance.hide("nbc-" + legendSuffix);
        instance.hide("bc-" + legendSuffix);
        instance.hide("d-" + legendSuffix);
    }
    
}

/**
 * Check if any row has been toggled. If no row is toggled, we'll toggle the first row.
 * Could differ from a user's expectation, but in most cases users will only be interested
 * in the latest run of the pipeline anyway.
 */
function checkIfAnyRowToggled(toggleStates) {
    if (JSON.stringify(toggleStates) != JSON.stringify({})) {
        for (var key in toggleStates) {
            // Since all the toggle states are saved together, and the display table values
            // are saved as "table-row-group" when toggled, we only need to check for "block" state
            // Not a very elegant solution but the toggle states can be split under two different keys
            if (toggleStates[key] == "block") {
                return true;
            }
        }
        return false;
    } else {
        return false;
    }
}

/**
 * Get the session state for any build toggles.
 */
function getToggleState(toggleId, toggleType, defaultToggleOn) {
    var toggleStates = JSON.parse(sessionStorage.toggleStates);

    if (toggleType == "block") {
        if (defaultToggleOn) {
            // If another row other than the first row is already toggled,
            // do not toggle the first row by default
            if (checkIfAnyRowToggled(toggleStates)) {
                if (toggleStates.hasOwnProperty(toggleId)) {
                    return toggleStates[toggleId];
                }
                return "none";
            }

            toggleStates[toggleId] = "block";
            sessionStorage.toggleStates = JSON.stringify(toggleStates);
            return "block";
        } else {
            if (toggleStates.hasOwnProperty(toggleId)) {
                return toggleStates[toggleId];
            }
        }
    }

    if (toggleType == "table-row-group") {
        if (toggleStates.hasOwnProperty(toggleId)) {
            return toggleStates[toggleId];
        } else {
            if (defaultToggleOn) {
                return "table-row-group";
            }
        }
    }

    return "none";
}

// Toggle method
function toggle(jobName, buildNum) {
    var toggleStates = JSON.parse(sessionStorage.toggleStates);
    var pipelineStageIdMap = JSON.parse(sessionStorage.pipelineStageIdMap);
    
    var toggleBuildId = "toggle-build-" + jobName + "-" + buildNum;
    var toggleRowId = "toggle-row-" + jobName + "-" + buildNum;
    var togglePipelineId = "toggle-pipeline-" + jobName + "-" + buildNum;

    var stageIds = pipelineStageIdMap[toggleBuildId];
    var ele = document.getElementById(toggleBuildId);
    var rowEle =  document.getElementById(toggleRowId);
    var pipelineEle = document.getElementById(togglePipelineId);

    if (ele.style.display == "block") {
        ele.style.display = "none";
        rowEle.className = "untoggled_build_header";
        pipelineEle.className = "untoggled_pipeline";
        toggleStates[toggleBuildId] = "none";

        // Hide all the connectors
        for (var key in stageIds) {
            instance.hide(key);
        }
        toggleLegend(jobName, buildNum, false);
    } else {
        ele.style.display = "block";
        rowEle.className = "toggled_build_header";
        pipelineEle.className = "toggled_pipeline";
        toggleStates[toggleBuildId] = "block";

        // Show all the connectors
        for (var key in stageIds) {
            instance.show(key);
        }
        toggleLegend(jobName, buildNum, true);
    }

    window.scrollTo(0, 0);
    instance.revalidate();

    // Recalculate offsets for every stage
    for (var pipeline in pipelineStageIdMap) {
        for (var stage in pipelineStageIdMap[pipeline]) {
            instance.recalculateOffsets(stage);
        }
    }

    sessionStorage.toggleStates = JSON.stringify(toggleStates);
    redrawConnections();
    window.scrollTo(0, sessionStorage.getItem("page_y"));
}

// For showing and hiding the display values table
function toggleTable(jobName, buildNum) {
    var toggleTableId = "toggle-table-" + jobName + "-" + buildNum;
    var displayTableId = "display-table-" + jobName + "-" + buildNum;
                            
    var toggleStates = JSON.parse(sessionStorage.toggleStates);
    var ele = document.getElementById(toggleTableId);
    var displayEle = document.getElementById(displayTableId);

    if (ele.style.display == "table-row-group") {
        ele.style.display = "none";
        displayEle.innerHTML = "Show Global Display Values";
        toggleStates[toggleTableId] = "none";
    } else {
        ele.style.display = "table-row-group";
        displayEle.innerHTML = "Hide Global Display Values";
        toggleStates[toggleTableId] = "table-row-group";
    }

    sessionStorage.toggleStates = JSON.stringify(toggleStates);
    redrawConnections();
}

/**
 * Toggle method for Full Screen. Used to toggle the display values table.
 */
function toggleTableCompatibleFS(jobName, buildNum) {
    var toggleTableId = "toggle-table-" + jobName + "-" + buildNum;
    var displayTableId = "display-table-" + jobName + "-" + buildNum;

    var currentPageY = sessionStorage.getItem("page_y");
    var toggleStates = JSON.parse(sessionStorage.toggleStates);
    var ele = document.getElementById(toggleTableId);
    var displayEle = document.getElementById(displayTableId);

    if (ele.style.display == "table-row-group") {
        ele.style.display = "none";
        displayEle.innerHTML = "Show Global Display Values";
        toggleStates[toggleTableId] = "none";
    } else {
        ele.style.display = "table-row-group";
        displayEle.innerHTML = "Hide Global Display Values";
        toggleStates[toggleTableId] = "table-row-group";
    }

    window.scrollTo(0, 0);

    instance.revalidate();

    sessionStorage.toggleStates = JSON.stringify(toggleStates);
    redrawConnections();
    window.scrollTo(0, currentPageY);
}

/**
 * Store the current page's Y position.
 */
function storePagePosition() {
  var page_y = window.pageYOffset;
  sessionStorage.setItem("page_y", page_y);
}

/**
 * Get the upstream stage name for any build triggered for any stage
 */
function getStageSource(stageName, stageBuildId) {
    var json = {};
    var isError = false;

    Q.ajax({
        url: rootURL + "job/" + stageName + "/" + stageBuildId + "/api/json?tree=actions[causes[*]],timestamp,duration,result",
        dataType: "json",
        type: "GET",
        async: false,
        cache: true,
        timeout: 2000,
        success: function(data) {
            json = data;
        },
        error: function (xhr, status, error) {
            isError = true;
        }
    })

    if (isError) {
        return null;
    }

    // Query must have a timestamp
    if (!json.hasOwnProperty("timestamp")) {
        return null;
    }

    if (json.hasOwnProperty("actions")) {
        var actions = json.actions;
        for (var k = 0; k < actions.length; k++) {
            if (actions[k].hasOwnProperty("causes")) {
                var causes = actions[k].causes;
                for (var l = 0; l < causes.length; l++) {
                    var cause = causes[l];
                    if (cause.hasOwnProperty("upstreamProject")) {
                        return cause.upstreamProject;
                    }
                }
            }
        }
    }

    return null;
}

/**
 * Updates the replay stage
 */
function replayUpdateStage(stageTimestamps, counter, pipelineNum) {
    var stage           = stageTimestamps[counter][0];
    var isStartTs       = stageTimestamps[counter][2];
    var overrideStatus  = stageTimestamps[counter][3];
    var sourceId        = stageTimestamps[counter][4];
    var stageBuildName  = stageTimestamps[counter][5];

    var stageId = getStageId(stage.id + "", pipelineNum);
    var stageStatus = stage.tasks[0].status.type;

    var styleMap = {
        "pipeline-nb"   : ["rgba(0,122,195,1)", 3.5, "2 2"],
        "pipeline-b"    : ["rgba(0,122,195,1)", 3.5, "0 0"],
        "pipeline-nbc"  : ["rgba(255,121,52,1)", 3.5, "2 2"],
        "pipeline-bc"   : ["rgba(255,121,52,1)", 3.5, "0 0"],
        "pipeline-d"    : ["rgba(118,91,161,1)", 3.5, "2 2"]
    }

    // All jsPlumb scopes to search for
    var allScopes = ["pipeline-nb","pipeline-b","pipeline-nbc","pipeline-bc","pipeline-d"];

    if (overrideStatus != null) {
        stageStatus = overrideStatus;
    }

    // Check all scopes
    for (var i = 0; i < allScopes.length; i++) {
        var scope = allScopes[i];
        var connections;
        if (sourceId != null) {
            connections = instance.select({
                scope   : scope,
                target  : stageId,
                source  : sourceId
            });
        } else {
            connections = instance.select({
                scope   : scope,
                target  : stageId
            });
        }

        if (stageStatus != "IDLE" && stageStatus != "DISABLED" && stageStatus != "NOT_BUILT") {
            if (isStartTs) {
                var ele = document.getElementById(stageId);
                ele.className = "circle circle_RUNNING";

                var buildNameEle = document.getElementById(stage.name + "-" + pipelineNum);
                buildNameEle.innerHTML = stageBuildName;
            } else {
                var ele = document.getElementById(stageId);
                ele.className = "circle circle_" + stageStatus;
            }
        }

        var strokeColor = isStartTs ? "yellow" : styleMap[scope][0];

        // Set the color to yellow and its z-index to 4 (same level as hovering over an arrow) if it is running
        // Otherwise, set the connection color and the z-index back to its default values
        connections.each(
            function(connection) {}).setPaintStyle({
                stroke: strokeColor,
                strokeWidth: styleMap[scope][1],
                dashstyle: styleMap[scope][2]
            }
        ).setHoverPaintStyle({
            stroke: strokeColor,
            strokeWidth: styleMap[scope][1] * 1.5
        }).setHover(false);

        if (isStartTs) {
            connections.each(function(connection) {}).addClass("running");
        } else {
            connections.each(function(connection) {}).removeClass("running");
        }
    }
}

/**
 * Replays the pipeline
 */
function replay(pipelineNum) {

    if (replayIsRunning) {
        alert("A replay is already running!");
        return;
    }

    var replayEle = document.getElementById("replay-" + pipelineNum);

    if (replayEle.className == "replay replayDisabled build_circle") {
        alert("The pipeline is currently running! Please wait for it to finish.");
        return;
    }

    replayIsRunning = true;    
    replayEle.className = "replay replayRunning build_circle";

    var pipeline = storedPipelines[pipelineNum];
    var stages = pipeline.stages;

    var stageTimestamps = [];
    var stageToNameMap = {};

    // Map each stage name to each stage object
    for (var i = 0; i < stages.length; i++) {
        var stage = stages[i];
        stageToNameMap[stage.name] = stage;
    }

    console.info("Replaying pipeline! { #" + stages[0].tasks[0].buildId + " " + stages[0].name + " }");

    // Set all stages to IDLE unless they are DISABLED / IDLE / NOT_BUILT
    for (var i = 0; i < stages.length; i++) {
        var stage = stages[i];
        var stageId = getStageId(stage.id + "", pipelineNum);
        var stageStatus = stage.tasks[0].status.type;
        var stageBuildName = "#" + stage.tasks[0].buildId + " " + stage.name;

        if (stageStatus != "DISABLED" && stageStatus != "IDLE" && stageStatus != "NOT_BUILT") {
            var ele = document.getElementById(stageId);
            ele.className = "circle circle_IDLE";

            var buildNameEle = document.getElementById(stage.name + "-" + pipelineNum);

            // To prevent the job name box from resizing due to a change in text length
            var tmpString = "#";
            tmpString += "_".repeat(buildNameEle.innerHTML.split(" ")[0].length - 1);

            buildNameEle.innerHTML = tmpString + " " + stage.name;
        }

        var startTs = parseInt(stage.tasks[0].status.timestamp);
        var endTs = startTs + parseInt(stage.tasks[0].status.duration);

        // Only add to the timestamp list if the timestamp is valid / exists
        if (isNaN(startTs)) {
            continue;
        }

        // Defaulted to null for all stages that only have 1 connection to it since it is redundant to look up the id
        var sourceStageId = null;

        // Use jsPlumb to check if there is more than one connection to a particular stage
        var allScopes = ["pipeline-nb","pipeline-b","pipeline-nbc","pipeline-bc","pipeline-d"];
        var numConnections = instance.getConnections({ scope: allScopes, target:stageId }, true).length;

        if (numConnections > 1) {
            console.info("More than one connection { " + numConnections + " } to stage: " + stage.name);

            if (stage.previousTasks.length > 0) {
                console.info("More than one build { " + (1 + stage.previousTasks.length) + " } was triggered at stage: " 
                        + stage.name);
            }

            // Extract the source stage for each additional build triggered for each stage
            // and add the start/end timestamps for each additional build
            for (var j = 0; j < stage.previousTasks.length; j++) {
                var prevTask = stage.previousTasks[j];
                var prevTaskSourceName = getStageSource(stage.name, prevTask.buildId);
                var prevTaskBuildName = "#" + prevTask.buildId + " " + stage.name;

                var prevTaskStartTs = parseInt(prevTask.status.timestamp);
                var prevTaskEndTs = prevTaskStartTs + parseInt(prevTask.status.duration);

                // Get the source stage id
                if (prevTaskSourceName != null) {
                    prevSourceStageId = getStageId(stageToNameMap[prevTaskSourceName].id + "", pipelineNum);
                }

                stageTimestamps.push([stage, prevTaskStartTs, true, prevTask.status.type, prevSourceStageId, prevTaskBuildName]);
                stageTimestamps.push([stage, prevTaskEndTs, false, prevTask.status.type, prevSourceStageId, prevTaskBuildName]);
            }

            // Get the source stage id for the lastest build for a particular stage and add it further below
            var sourceStageName = getStageSource(stage.name, stage.tasks[0].buildId);

            if (sourceStageName != null) {
                sourceStageId = getStageId(stageToNameMap[sourceStageName].id + "", pipelineNum);
            }
        } else {
            if (stage.previousTasks.length > 0) {
               console.info("More than one build { " + (1 + stage.previousTasks.length) + " } was triggered at stage: " 
                    + stage.name);
            }

            // Adding start/end timestamps for stages with multiple builds but only 1 source stage
            for (var j = 0; j < stage.previousTasks.length; j++) {
                var prevTask = stage.previousTasks[j];
                var prevTaskBuildName = "#" + prevTask.buildId + " " + stage.name;

                var prevTaskStartTs = parseInt(prevTask.status.timestamp);
                var prevTaskEndTs = prevTaskStartTs + parseInt(prevTask.status.duration);

                stageTimestamps.push([stage, prevTaskStartTs, true, prevTask.status.type, null, prevTaskBuildName]);
                stageTimestamps.push([stage, prevTaskEndTs, false, prevTask.status.type, null, prevTaskBuildName]);
            }
        }

        // Add the timestamps for the latest build for each stage
        stageTimestamps.push([stage, startTs, true, null, sourceStageId, stageBuildName]);
        stageTimestamps.push([stage, endTs, false, null, sourceStageId, stageBuildName]);
    }

    // Sort all the timestamps
    stageTimestamps = stageTimestamps.sort(function(a, b) {
        var timestampA = a[1];
        var timestampB = b[1];
        return timestampA - timestampB;
    });

    var counter = 0;
    for (var i = 0; i < stageTimestamps.length; i++) {
        sleep(i * 1000).then(() => {
            replayUpdateStage(stageTimestamps, counter, pipelineNum);
            counter++;
        });
    }

    sleep(stageTimestamps.length * 1000).then(() => {
        console.info("Replay complete! Refreshing page!");
        replayIsRunning = false;
        replayEle.className = "replay replayStopped build_circle";

        // Refresh after replay is complete since a running replay will prevent a pipeline update
        // Also ensures the validity of the pipeline information in the event replay has a bug somewhere
        refreshFn(false);
    });
}

function sleep (time) {
    return new Promise((resolve) => setTimeout(resolve, time));
}