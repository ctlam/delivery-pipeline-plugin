var instance;
// Jenkins default view has a "main-panel" whereas full screen mode does not
var isFullScreen = (document.getElementById("main-panel") == null);
var numColumns = 0;

function pipelineUtils() {
    var self = this;
    this.updatePipelines = function(divNames, errorDiv, view, fullscreen, page, component, showChanges, aggregatedChangesGroupingPattern, timeout, pipelineid, jsplumb) {
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

        if (sessionStorage.previousDisplayArgConfig == null) {
            sessionStorage.previousDisplayArgConfig = JSON.stringify({});
        }

        if (sessionStorage.toggleStates == null) {
            sessionStorage.toggleStates = JSON.stringify({});
        }

        if (sessionStorage.blockedOnFailedMap == null) {
            sessionStorage.blockedOnFailedMap = JSON.stringify({});
        }

        // Clear the sessionStorage of values we set if and only if we are loading a different view page
        // This could break if someone loads a view with the same initial job.
        var lastViewedJob;
        try {
            lastViewedJob = sessionStorage.getItem("lastViewedJob");
            var currentJob = data.pipelines[0].name;

            if (lastViewedJob !== undefined && (currentJob != lastViewedJob)) {
                sessionStorage.savedPipelineDisplayValues = JSON.stringify({});
                sessionStorage.savedPipelineArtifacts = JSON.stringify({});
                sessionStorage.toggleStates = JSON.stringify({});
                sessionStorage.blockedOnFailedMap = JSON.stringify({});
            }
            sessionStorage.lastViewedJob = currentJob;
        } catch (e) {
            console.info(e);
        }

        if (data.error) {
            cErrorDiv.html('Error: ' + data.error).show();
        } else {
            cErrorDiv.hide().html('');
        }

        // Get the display arguments from a specified project url
        var displayArgumentsFromProject = {};
        if (!isNullOrEmpty(data.displayArgumentsProject)) {
            try {
                // Attempt to parse the contents
                var returnedArguments = retrieveDisplayArgumentsFromProject(data.displayArgumentsProject);
                if (data.useYamlParser) {
                    displayArgumentsFromProject = jsyaml.safeLoad(returnedArguments);
                } else {
                    displayArgumentsFromProject = JSON.parse(returnedArguments);
                }
            } catch (e) {
                console.log(e);
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
            console.log(e);
        }

        // Hope that jQuery can perform the deep merge
        try {
            displayArguments = Q.extend(true, {}, displayArgumentsFromProject, displayArguments);
        } catch (e) {
            console.log("Error performing deep merge on display arguments");
        }
        
        if (lastResponse === null || JSON.stringify(data.pipelines) !== JSON.stringify(lastResponse.pipelines)) {

            for (var z = 0; z < divNames.length; z++) {
                Q("#" + divNames[z]).html('');
            }

            if (!data.pipelines || data.pipelines.length === 0) {
                Q("#pipeline-message-" + pipelineid).html('No pipelines configured or found. Please review the <a href="configure">configuration</a>')
            }

            jsplumb.reset();
            // Keep track of the jsplumb instance so that we can repaint when necessary
            instance = jsplumb;

            for (var c = 0; c < data.pipelines.length; c++) {
                html = [];
                component = data.pipelines[c];

                var returnUrl = window.location.href;
                if (isFullScreen) {
                    returnUrl = returnUrl.split("?fullscreen=true")[0];
                }

                html.push("<section class='pipeline-component'>");
                html.push("<div class=\"pipelineHeader\">");
                html.push("<h1><a href=\"" + returnUrl + "\">" + component.name + "</a>");
                if (data.allowPipelineStart) {
                    if (component.firstJobParameterized) {
                        html.push('&nbsp;<a id=\'startpipeline-' + c  +'\' class="task-icon-link" href="#" onclick="triggerParameterizedBuild(\'' + component.firstJobUrl + '\', \'' + data.name + '\');">');
                    } else {
                        html.push('&nbsp;<a id=\'startpipeline-' + c  +'\' class="task-icon-link" href="#" onclick="triggerBuild(\'' + component.firstJobUrl + '\', \'' + data.name + '\');">');
                    }
                    html.push('<img class="icon-clock icon-md" title="Build now" src="' + resURL + '/images/24x24/clock.png">');
                    html.push("</a>");
                }
                html.push("</h1>");
                html.push("<h2>Refreshed every " + data.updateInterval + " seconds.");
                if (isFullScreen) {
                    html.push("<br/>Press ESC at any time to return to the default view.");
                }
                html.push("</h2>");
                html.push("</div>");
                if (!showAvatars) {
                    html.push("<div class='pagination'>");
                    html.push(component.pagingData);
                    html.push("</div>");
                }
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
                html.push("</tr>");

                var isLatestPipeline = true;

                for (var i = 0; i < component.pipelines.length; i++) {
                    pipeline = component.pipelines[i];

                    var jobName = component.firstJobUrl.substring(4, component.firstJobUrl.length - 1);
                    var buildNum = pipeline.version.substring(1);
                    var statusString = pipeline.stages[0].tasks[0].status.type;

                    var pipelineTimestamp = formatLongDate(pipeline.timestamp);
                    var pipelineDuration = formatLongDuration(pipeline.stages[0].tasks[0].status.duration);
                        
                    if (!data.useFullLocaleTimeStrings) {
                        pipelineTimestamp = formatDate(pipeline.timestamp);
                        pipelineDuration = formatDuration(pipeline.stages[0].tasks[0].status.duration);
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
                    html.push("<p class=\"circle_header circle_" + statusString + " build_circle\">&nbsp;</p></a></td>");

                    html.push("<td class=\"build_column\"><a href=\"" + toggleFunction + "\" style=\"text-decoration:none;\">");
                    html.push("<p class=\"build_entry\">#" + buildNum + " " + jobName + "</p></a></td>");

                    html.push("<td class=\"build_column\"><a href=\"" + toggleFunction + "\" style=\"text-decoration:none;\">");
                    html.push("<p class=\"build_entry\">" + pipelineDuration + "</p></a></td>");

                    html.push("<td class=\"build_column\"><a href=\"" + toggleFunction + "\" style=\"text-decoration:none;\">");
                    html.push("<p class=\"build_entry\">" + pipelineTimestamp + "</p></a></td>");

                    html.push("<td class=\"build_column\"><a href=\"" + toggleFunction + "\" style=\"text-decoration:none;\">");
                    html.push("<p class=\"build_entry\">" + triggered + "</p></a></td>");

                    html.push("</tr><tr><th id=\"" + togglePipelineId + "\" colspan=\"5\" class=\"" + initPipelineClass + "\">");
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

                        html.push("<section class=\"pipeline\">");
                        html.push("<div class=\"pipeline-row\">");

                        //if (displayArguments != "" && displayArguments != null) {
                        if (JSON.stringify(displayArguments) != JSON.stringify({})) {
                            var toggleTableId = "toggle-table-" + jobName + "-" + buildNum;
                            var displayTableId = "display-table-" + jobName + "-" + buildNum;
                            var artifactId = "artifacts-" + jobName + "-" + buildNum;

                            var toggleTableFunction = "javascript:toggleTable('" + toggleTableId + "','" + displayTableId + "');";
                            var initDisplayValMessage = (getToggleState(toggleTableId, "table-row-group", true) == "none") ? "Show " : "Hide ";
                            initDisplayValMessage += "Global Display Values";

                            if (isFullScreen) {
                                toggleTableFunction = "javascript:toggleTableCompatibleFS('" + toggleTableId + "','" + displayTableId + "');";
                            }

                            html.push("<div class=\"pipeline-cell\" style=\"vertical-align: top\">");

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
                    html.push("<section class=\"pipeline\">");
                    html.push('<div class="pipeline-row">');

                    for (var j = 0; j < pipeline.stages.length; j++) {
                        stage = pipeline.stages[j];

                        if (stage.blockingJobs != "") {
                            blockingMap[getStageId(stage.id + "", i)] = stage.blockingJobs.split(', ');
                        }

                        if (stage.conditionalJobs != "") {
                            conditionalMap[getStageId(stage.id + "", i)] = stage.conditionalJobs.split(', ');
                        }

                        if (stage.downstreamJobs != "") {
                            downstreamMap[getStageId(stage.id + "", i)] = stage.downstreamJobs.split(', ');
                        }

                        projectNameIdMap[getStageId(stage.id + "", i)] = stage.name;

                        if (stage.row > row) {
                            html.push('</div><div class="pipeline-row">');
                            column = 0;
                            row++;
                        }

                        if (stage.column > column) {
                            for (var as = column; as < stage.column; as++) {
                                if (data.viewMode == "Minimalist") {
                                    html.push("<div class=\"pipeline-cell\">");
                                    html.push("<div class=\"stage-minimalist hide\" style=\"width: " + widthPerCell + "px;\"></div></div>");
                                }
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

                        if (data.viewMode == "Minimalist") {
                            html.push("<div class=\"stage-minimalist\" style=\"width: " + widthPerCell + "px;\">");    
                            html.push("<div class=\"stage-header\" style=\"font-size: " + fontSizePerCell + "px;\">");
                            html.push("<div class=\"stage-name\">");
                            html.push("<a href=\"" + link + "\" target=\"_blank\">" + htmlEncode("#" + stage.tasks[0].buildId + " " + stage.name) + "</a></div>");
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

                            if (data.viewMode == "Minimalist") {
                                var toolTipStyle = Math.round(column / numColumns) < 0.5 ? "left: 0%;" : "right: 0%;"
                                var hoverTable = "<table class=\"hoverTable\"><tr class=\"hoverRow\">";
                                hoverTable += "<th class=\"hoverTableTh\">Status:</th>";
                                hoverTable += "<td class=\"hoverTableTd\">" + task.status.type + "</td></tr><tr class=\"hoverRow\">"
                                hoverTable += "<th class=\"hoverTableTh\">Timestamp:</th>";
                                hoverTable += "<td class=\"hoverTableTd\">" + timestamp + "</td></tr><tr class=\"hoverRow\">";
                                hoverTable += "<th class=\"hoverTableTh\">Duration:</th>";
                                hoverTable += "<td class=\"hoverTableTd\">" + formatLongDuration(task.status.duration) + "</td></tr>";
                                hoverTable += generateStageDisplayValueTable(displayArguments, jobName, stage.name, getStageId(stage.id + "", i));
                                hoverTable += "</table>";

                                html.push("<div id=\"" + id + "\" class=\"stage-task\">");
                                html.push("<div class=\"task-header\">");
                                html.push("<div class=\"taskname\">");
                                html.push("<a id=\"" + getStageId(stage.id + "", i) + "\" class=\"circle circle_" + task.status.type + "\" ");
                                html.push("href=\"" + getLink(data, task.link) + consoleLogLink + "\" target=\"_blank\" ");
                                html.push("style=\"left: " + leftPercentPerCell + "; height: " + circleSizePerCell + "; width: " + circleSizePerCell + "; ");
                                html.push("background-size: " + circleSizePerCell + " " + circleSizePerCell + ";\">");
                                html.push("<br/><span class=\"tooltip\" style=\"" + toolTipStyle + "\">" + hoverTable + "</span></a>");
                                html.push("</div></div></div>");
                            }
                        }

                        if (pipeline.aggregated && stage.changes && stage.changes.length > 0) {
                            html.push(generateAggregatedChangelog(stage.changes, aggregatedChangesGroupingPattern));
                        }

                        html.push("</div></div>");
                        column++;
                    }

                    if (!pipeline.aggregated) {
                        var jobName = component.firstJobUrl.substring(4, component.firstJobUrl.length - 1);
                        var buildNum = pipeline.version.substring(1);

                        if (data.showArtifacts) {
                            var artifactValues = JSON.parse(sessionStorage.savedPipelineArtifacts);
                            var artifactId = "artifacts-" + jobName + "-" + buildNum;

                            if (!artifactValues.hasOwnProperty(artifactId)) {
                                getBuildArtifacts(jobName, buildNum, artifactId);    
                            }
                        }

                        getGlobalDisplayValues(displayArguments, pipeline, jobName, buildNum);
                    }

                    html.push('</div></section></div></th></tr>');
                }

                html.push("</table>")
                html.push("</section>");
                Q("#" + divNames[c % divNames.length]).append(html.join(""));
                Q("#pipeline-message-" + pipelineid).html('');
            }

            // Mark the stages that failed on a blocking call
            for (var i = 0; i < component.pipelines.length; i++) {
                pipeline = component.pipelines[i];
                var pipelineNum = pipeline.version.substring(1);

                if (!JSON.parse(sessionStorage.blockedOnFailedMap).hasOwnProperty(pipeline.stages[0].name + "-" + pipelineNum)) {
                    updateFailedOnBlockStages(pipeline, i);    
                } else {
                    loadFailedOnBlockStages(pipeline, i);
                }
            }

            var pipelineStageIdMap = {};
            
            // Create a pipeline - stage id mapping
            for (var i = 0; i < component.pipelines.length; i++) {
                pipeline = component.pipelines[i];
                var jobName = component.firstJobUrl.substring(4, component.firstJobUrl.length - 1);
                var buildNum = pipeline.version.substring(1);
                var toggleBuildId = "toggle-build-" + jobName + "-" + buildNum;
                var stageIds = {};

                for (var j = 0; j < pipeline.stages.length; j++) {
                    stage = pipeline.stages[j];

                    var id = getStageId(stage.id + "", i);
                    stageIds[id] = "true";

                    // We can update specific stage display values here as well
                    getStageDisplayValues(displayArguments, jobName, stage.name, stage.tasks[0].buildId, id);
                }
                pipelineStageIdMap[toggleBuildId] = stageIds;
            }

            sessionStorage.pipelineStageIdMap = JSON.stringify(pipelineStageIdMap);

            var index = 0, source, target;
            var anchors = [[1, 0, 1, 0, 0, 13], [0, 0, -1, 0, 0, 13]];
            var downstreamAnchors = [[0.5, 1, 0, 1, 0, 1], [0, 0, -1, 0, -0.5, 13]];
            var backgroundColor = "rgba(31,35,41,1)";

            lastResponse = data;
            equalheight(".pipeline-row .stage");

            // use jsPlumb to draw the connections between stages
            Q.each(data.pipelines, function (i, component) {
                Q.each(component.pipelines, function (j, pipeline) {
                    index = j;
                    Q.each(pipeline.stages, function (k, stage) {
                        if (stage.downstreamStages) {
                            Q.each(stage.downstreamStageIds, function (l, value) {
                                source = getStageId(stage.id + "", index);
                                target = getStageId(value + "", index);
                                
                                var color = "rgba(0,122,195,1)";    // Default blue
                                var label = "Non-blocking";         // Default non-blocking
                                var dashstyle = "2 2";              // Default dashed line
                                var strokeWidth = 3.5;                // Default line width of 3.5
                                var stub = scaleCondition ? 30 : 80;
                                var lastBlockingJob;

                                var blockedProjects = conditionalProjects = downstreamProjects = [];
                                var targetName;
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
                                    } else if (blockedProjects.indexOf(targetName) != -1) {
                                        color = "rgba(0,122,195,1)";    // Blue
                                        label = "Blocking";
                                        dashstyle = "0 0";
                                    } else if (conditionalProjects.indexOf(targetName) != -1) {
                                        color = "rgba(255,121,52,1)";   // Orange
                                        label = "Non-blocking Conditional";
                                    }

                                    if (downstreamProjects.indexOf(targetName) != -1) {
                                        color = "rgba(118,91,161,1)";   // Purple
                                        label = "Downstream";
                                        stub = 10;
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

                                // Draw a hidden connection hide the bad line overlapping
                                // Only do it if there is a mix of conditional and blocking jobs however as having all
                                // blocking jobs (or blue lines) looks visually ok
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
                                    endpoint: "Blank"
                                });

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

                    if (getToggleState(toggleBuildId, "block", isLatestPipeline) == "none") {
                        var stageIds = pipelineStageIdMap[toggleBuildId];

                        for (var key in stageIds) {
                            jsplumb.hide(key);
                        }
                    }
                    if (isLatestPipeline) {
                        isLatestPipeline = false;
                    }
                }
            }

            for (var a = 0; a < data.pipelines.length; a++) {
                var component = data.pipelines[a];
                var isLatestPipeline = true;

                for (var i = 0; i < component.pipelines.length; i++) {
                    pipeline = component.pipelines[i];

                    var jobName = component.firstJobUrl.substring(4, component.firstJobUrl.length - 1);
                    var buildNum = pipeline.version.substring(1);

                    var legendMap = {};

                    legendMap["b-" + jobName + "-" + buildNum] = ["rgba(0,122,195,1)", "0 0"];
                    legendMap["nb-" + jobName + "-" + buildNum] = ["rgba(0,122,195,1)", "2 2"];
                    legendMap["nbc-" + jobName + "-" + buildNum] = ["rgba(255,121,52,1)", "2 2"];
                    legendMap["bc-" + jobName + "-" + buildNum] = ["rgba(255,121,52,1)", "0 0"];
                    legendMap["d-" + jobName + "-" + buildNum] = ["rgba(118,91,161,1)", "2 2"];

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
    window.location.href = rootURL + "/" + url + 'build?delay=0sec';
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
        },
        error: function (jqXHR, textStatus, errorThrown) {
            window.alert("Could not trigger build! error: " + errorThrown + " status: " + textStatus)
        }
    });
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
    Q.ajax({
        url: rootURL + "/job/" + jobName + "/" + buildNum + "/api/json?tree=artifacts[*]",
        type: "GET",
        dataType: 'json',
        async: true,
        cache: true,
        timeout: 20000,
        success: function (json) {
            getBuildArtifactData(jobName, buildNum, buildId, json.artifacts);
        },
        error: function (xhr, status, error) {
        }
    })
}

/**
 * Callback function to get an artifacts data.
 */
function getBuildArtifactData(jobName, buildNum, buildId, data) {
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
}

/**
 * Callback function to generate a link to a specific build artifact.
 */
function getBuildArtifactLinks(url, json, buildId) {
    var savedValues = JSON.parse(sessionStorage.savedPipelineArtifacts);
    var ele = document.getElementById(buildId);
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
                    if (savedValues.hasOwnProperty(id)) {
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
                        url = "job/" + projectName + "/" + projectNameIdMap[projectName] + "/artifact/" + artifactName;
                        if (projectNameIdMap[projectName] == null) {
                            return;
                        }
                    }

                    if (filePath != "") {
                        url = "job/" + projectName + "/ws/" + filePath;
                    }

                    if (envName != "" || paramName != "") {
                        url = "job/" + projectName + "/" + projectNameIdMap[projectName] + "/injectedEnvVars/api/json";
                        if (projectNameIdMap[projectName] == null) {
                            return;
                        }
                    }

                    if (fromConsole == "true" || fromConsole == true) {
                        url = "job/" + projectName + "/" + projectNameIdMap[projectName] + "/consoleText";
                        if (projectNameIdMap[projectName] == null) {
                            return;
                        }
                    }

                    // In the event that somehow we fail to create a URL
                    if (url == "") {
                        continue;
                    }

                    // Upon a configuration change, reload all data
                    if (previousDisplayArgConfig != displayArgs) {
                        Q.ajax({
                            url: rootURL + "/" + url,
                            type: "GET",
                            async: true,
                            cache: true,
                            timeout: 20000,
                            success: function(data) {
                                updateGlobalDisplayValues(data, this.url, displayArgs, pipelineName, pipelineNum);
                            },
                            error: function (xhr, status, error) {
                            }
                        })
                    }
                }
            }
        }
        else {
            // We expect a project name for each display value -- otherwise we don't know where to look
            continue;
        }
    }

    if (JSON.parse(sessionStorage.previousDisplayArgConfig) != displayArgs) {
        sessionStorage.previousDisplayArgConfig = JSON.stringify(displayArgs);
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
                            var toolTipData = data.replace(/-/g, '&#x2011;');

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
                            var toolTipData = data.replace(/-/g, '&#x2011;');

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
function generateStageDisplayValueTable(displayArgs, pipelineName, stageName, stageId) {
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
                retVal += "<td id=\"" + stageId + "-" + displayKey.replace(re, '_') + "\" class=\"hoverTableTd\">Value not found across pipeline</td></tr>";  
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
    var re = new RegExp(' ', 'g');

    for (var mainProject in displayArgs) {
        if (mainProject == pipelineName) {
            // Check for stage specific display arguments
            if (!displayArgs[mainProject].hasOwnProperty(stageName)) {
                return;
            }
            var mainProjectDisplayConfig = (displayArgs[mainProject])[stageName];

            for (var displayKey in mainProjectDisplayConfig) {
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
                    url = "job/" + stageName + "/" + stageBuildNum + "/artifact/" + artifactName;
                }

                if (filePath != "") {
                    url = "job/" + stageName + "/ws/" + filePath;
                }

                if (envName != "" || paramName != "") {
                    url = "job/" + stageName + "/" + stageBuildNum + "/injectedEnvVars/api/json";
                }

                if (fromConsole == "true" || fromConsole == true) {
                    url = "job/" + stageName + "/" + stageBuildNum + "/consoleText";
                }

                // In the event that somehow we fail to create a URL
                if (url == "") {
                    continue;
                }

                // Upon a configuration change, reload all data
                if (previousDisplayArgConfig != displayArgs) {
                    Q.ajax({
                        url: rootURL + "/" + url,
                        type: "GET",
                        async: true,
                        cache: true,
                        timeout: 20000,
                        success: function(data) {
                            updateStageDisplayValues(this.url, data, displayArgs, pipelineName, stageName, stageId);
                        },
                        error: function (xhr, status, error) {
                        }
                    })
                }
            }
        }
    }
}

 /**
  * Callback function to update the stage specific display values
  */
function updateStageDisplayValues(url, data, displayArgs, pipelineName, stageName, stageId) {
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
                                var id = stageId + "-" + displayKey.replace(re, '_');
                                var ele = document.getElementById(id);

                                if (displayKeyConfig.hasOwnProperty("grepPattern")) {
                                    var grepPattern = displayKeyConfig.grepPattern;
                                    var grepFlag = displayKeyConfig.hasOwnProperty("grepFlag") ? displayKeyConfig.grepFlag : 'g';
                                    ele.innerHTML = grepRegexp(grepPattern, grepFlag, envMap[envName]);
                                } else {
                                    ele.innerHTML = envMap[envName];    
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

                        var id = stageId + "-" + displayKey.replace(re, '_');
                        var ele = document.getElementById(id);
                        ele.innerHTML = toolTipData;
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

                        var id = stageId + "-" + displayKey.replace(re, '_');
                        var ele = document.getElementById(id);
                        ele.innerHTML = toolTipData;
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

        if (downstreamStages.size() == 0) {
            continue;
        }

        if (stage.tasks[0].status.type == "FAILED") {
            for (var k = 0; k < downstreamStages.size(); k++) {
                if (blockingJobs.split(', ').indexOf(downstreamStages[k]) != -1) {
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
 * Retrieves the display arguments from an existing project
 */
function retrieveDisplayArgumentsFromProject(projectUrl) {
    var displayArguments;
    Q.ajax({
        url: rootURL + "/job/" + projectUrl + "/*view*/",
        type: "GET",
        async: false,
        cache: true,
        timeout: 20000,
        success: function(data) {
            displayArguments = data;
        },
        error: function (xhr, status, error) {
        }
    })
    return displayArguments;
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
    } else {
        ele.style.display = "block";
        rowEle.className = "toggled_build_header";
        pipelineEle.className = "toggled_pipeline";
        toggleStates[toggleBuildId] = "block";

        // Show all the connectors
        for (var key in stageIds) {
            instance.show(key);
        }
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
function toggleTable(toggleTableId, displayTableId) {
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
 * Toggle method for Full Screen. Used to toggle build rows.
 * The toggle() method works fine in both normal view and fullscreen.
 * However, we'll leave this method in case of any new visual bugs.
 */
function toggleCompatibleFs(jobName, buildNum) {
    var toggleStates = JSON.parse(sessionStorage.toggleStates);
    var pipelineStageIdMap = JSON.parse(sessionStorage.pipelineStageIdMap);

    var toggleBuildId = "toggle-build-" + jobName + "-" + buildNum;

    if (toggleStates.hasOwnProperty(toggleBuildId)) {
        if (toggleStates[toggleBuildId] == "none") {
            toggleStates[toggleBuildId] = "block";
        } else {
            toggleStates[toggleBuildId] = "none";
        }
    } else {
        toggleStates[toggleBuildId] = "block";
    }

    for (var buildId in toggleStates) {
        if (toggleStates.hasOwnProperty(buildId)) {
            var rowId = "toggle-row-" + buildId.split("toggle-build-")[1];
            var pipelineId = "toggle-pipeline-" + buildId.split("toggle-build-")[1];
            
            var ele = document.getElementById(buildId);
            var rowEle = document.getElementById(rowId);
            var pipelineEle = document.getElementById(pipelineId);

            console.info("Hiding: " + buildId);

            ele.style.display = "none";
            rowEle.className = "untoggled_build_header";
            pipelineEle.className = "untoggled_pipeline";

            var stageIds = pipelineStageIdMap[buildId];
            // Hide all the connectors
            for (var key in stageIds) {
                instance.hide(key);
            }  
        }
    }

    var sorted = [];
    for (var buildId in toggleStates) {
        sorted.push(buildId);
    }

    sorted.sort(function(a, b) {
        var buildNumA = parseInt(a.split("-").slice(-1)[0]);
        var buildNumB = parseInt(b.split("-").slice(-1)[0]);
        return buildNumA - buildNumB;
    });

    var orderedString = sorted.join(",");

    while(orderedString != "") {
        var buildId = orderedString.split(",")[0];

         if (toggleStates.hasOwnProperty(buildId) && toggleStates[buildId] == "block") {
            var rowId = "toggle-row-" + buildId.split("toggle-build-")[1];
            var pipelineId = "toggle-pipeline-" + buildId.split("toggle-build-")[1];
            
            var ele = document.getElementById(buildId);
            var rowEle = document.getElementById(rowId);
            var pipelineEle = document.getElementById(pipelineId);

            ele.style.display = "block";
            rowEle.className = "toggled_build_header";
            pipelineEle.className = "toggled_pipeline";

            var stageIds = pipelineStageIdMap[buildId];
            // Show all the connectors
            for (var key in stageIds) {
                instance.show(key);
            }  
        }

        orderedString = orderedString.split(",").slice(1).join(",");
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
    instance.repaintEverything();

    window.scrollTo(0, sessionStorage.getItem("page_y"));
}

/**
 * Toggle method for Full Screen. Used to toggle the display values table.
 */
function toggleTableCompatibleFS(toggleTableId, displayTableId) {
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
