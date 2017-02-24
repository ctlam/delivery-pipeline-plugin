var instance;

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

                            // Need this for manifest - CL tracking
                            var clManifestMap = {};

                            if (sessionStorage.savedPipelineDisplayValues == null) {
                                sessionStorage.savedPipelineDisplayValues = JSON.stringify({});
                            }
                            var savedPipelineDisplayValues = JSON.parse(sessionStorage.savedPipelineDisplayValues);

                            if (sessionStorage.toggleStates == null) {
                                sessionStorage.toggleStates = JSON.stringify({});
                            }

                            if (data.error) {
                                cErrorDiv.html('Error: ' + data.error).show();
                            } else {
                                cErrorDiv.hide().html('');
                            }

                            if (lastResponse === null || JSON.stringify(data.pipelines) !== JSON.stringify(lastResponse.pipelines)) {

                                for (var z = 0; z < divNames.length; z++) {
                                    Q("#" + divNames[z]).html('');
                                }

                                if (!data.pipelines || data.pipelines.length === 0) {
                                    Q("#pipeline-message-" + pipelineid).html('No pipelines configured or found. Please review the <a href="configure">configuration</a>')
                                }

                                jsplumb.reset();
                                instance = jsplumb;

                                for (var c = 0; c < data.pipelines.length; c++) {
                                    html = [];
                                    component = data.pipelines[c];
                                    html.push("<section class='pipeline-component'>");
                                    html.push("<h1>" + htmlEncode(component.name));
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
                                    if (!showAvatars) {
                                        html.push("<div class='pagination'>");
                                        html.push(component.pagingData);
                                        html.push("</div>");
                                    }
                                    if (component.pipelines.length === 0) {
                                        html.push("No builds done yet.");
                                    }

                                    for (var i = 0; i < component.pipelines.length; i++) {
                                        pipeline = component.pipelines[i];

                                        var jobName = component.firstJobUrl.substring(4, component.firstJobUrl.length - 1);
                                        var buildNum = pipeline.version.substring(1);
                                        var statusString = pipeline.stages[0].tasks[0].status.type;

                                        var dataString = jobName + " " + pipeline.version;
                                        var displayBuildId = "display-build-" + jobName + "-" + buildNum;
                                        var toggleBuildId = "toggle-build-" + jobName + "-" + buildNum;

                                        html.push('<br><a id="' + displayBuildId + '" class="build_header build_' + statusString + '" href="javascript:toggle(\'' + toggleBuildId + '\');">' + dataString + " " + statusString + '</a> ');
                                        html.push('<div id="' + toggleBuildId + '" style="display:' + getToggleState(toggleBuildId, "block") +'">');

                                        if (pipeline.triggeredBy && pipeline.triggeredBy.length > 0) {
                                            triggered = "";
                                            for (var y = 0; y < pipeline.triggeredBy.length; y++) {
                                                trigger = pipeline.triggeredBy[y];
                                                triggered = triggered + ' <span class="' + trigger.type + '">' + htmlEncode(trigger.description) + '</span>';
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

                                        if (pipeline.aggregated) {
                                            if (component.pipelines.length > 1) {
                                                html.push('<h3>Aggregated view</h3>');
                                            }
                                        } else {
                                            html.push("<table style=\"min-width:500px; text-align:left; padding: 0px 50px 0px 0px;\">");
                                            if (data.useFullLocaleTimeStrings) {
                                                html.push("<tr><th>Started on: </th><td>" + formatLongDate(pipeline.timestamp) + "</td></tr>");
                                                html.push("<tr><th>Duration (Dd HH:MM:SS): </th><td>" + formatLongDuration(pipeline.stages[0].tasks[0].status.duration) + "</td></tr>");
                                                html.push("<tr><th>Triggered by: </th><td>" + triggered + "</td></tr>");
                                            }
                                            else {
                                               html.push('<h3>' + htmlEncode(pipeline.version));
                                                if (triggered != "") {
                                                    html.push(" triggered by " + triggered);
                                                }
                                                html.push(' - Started <span id="' + pipeline.id + '\">' + formatDate(pipeline.timestamp, lastUpdate) + '</span></h3>');
                                            }

                                            if (data.showTotalBuildTime) {
                                                html.push('<h3>Total build time: ' + formatDuration(pipeline.totalBuildTime) + '</h3>');
                                            }

                                            if (data.showArtifacts) {
                                                html.push("<tr><th>Artifacts: </th><td>" + getBuildArtifactLinks(jobName, buildNum) + "</td></tr>");
                                            }

                                            if (showChanges && pipeline.changes && pipeline.changes.length > 0) {
                                                html.push(generateChangeLog(pipeline.changes));
                                            }

                                            html.push("</table><h3><br></h3>");

                                            if (data.displayArguments != "") {
                                                var toggleTableId = "toggle-table-" + jobName + "-" + buildNum;
                                                var displayTableId = "display-table-" + jobName + "-" + buildNum;

                                                html.push('<h3><a id="' + displayTableId + '" href="javascript:toggleTable(\'' + toggleTableId + '\');">Additional Display Values</a></h3>');
                                                html.push("<table id=\"" + toggleTableId + "\" style=\"display:" +  getToggleState(toggleTableId, "table") + "; min-width:500px; text-align:left; padding: 0px 50px 0px 0px;\">");
                                                if (JSON.stringify(savedPipelineDisplayValues) == JSON.stringify({})) {
                                                    html.push(generateDisplayValueTable(data.displayArguments, jobName, buildNum));
                                                } else {
                                                    html.push(loadDisplayValues(data.displayArguments, jobName, buildNum, savedPipelineDisplayValues));
                                                }
                                                html.push("</table>");
                                            }

                                            html.push('<h3><br></h3>');
                                        }

                                        html.push('<section class="pipeline">');

                                        var row = 0, column = 0, stage;

                                        html.push('<div class="pipeline-row">');
 
                                        for (var j = 0; j < pipeline.stages.length; j++) {
                                            stage = pipeline.stages[j];

                                            if (stage.row > row) {
                                                html.push('</div><div class="pipeline-row">');
                                                column = 0;
                                                row++;
                                            }

                                            if (stage.column > column) {
                                                for (var as = column; as < stage.column; as++) {
                                                    if (data.viewMode == "Minimalist") {
                                                        html.push('<div class="pipeline-cell"><div class="stage-minimalist hide"></div></div>');
                                                    } else {
                                                        html.push('<div class="pipeline-cell"><div class="stage hide"></div></div>');
                                                    }
                                                    column++;
                                                }
                                            }

                                            html.push('<div class="pipeline-cell">');

                                            if (data.viewMode == "Minimalist") {
                                                var timestamp = "";
                                                if (data.useFullLocaleTimeStrings) {
                                                  timestamp = formatCardLongDate(stage.tasks[0].status.timestamp);
                                                } else {
                                                  timestamp = formatDate(stage.tasks[0].status.timestamp, lastUpdate);
                                                }

                                                var hoverString = "Timestamp: " + timestamp + "<br>Duration: " + formatDuration(stage.tasks[0].status.duration);

                                                html.push('<div class="stage-minimalist ' + getStageClassName(stage.name) + '">');
                                                html.push('<div class="stage-minimalist-header"><div class="stage-minimalist-name"><a href="' + getLink(data, stage.tasks[0].link) + '">' + htmlEncode("#" + stage.tasks[0].buildId + " " + stage.name) + '</a></div>');
                                            } else {
                                                html.push('<div id="' + getStageId(stage.id + "", i) + '" class="stage ' + getStageClassName(stage.name) + '">');
                                                html.push('<div class="stage-header"><div class="stage-name build_' + stage.tasks[0].status.type +'">' + htmlEncode("#" + stage.tasks[0].buildId + " " + stage.name) + '</div>');
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

                                                if (data.useFullLocaleTimeStrings) {
                                                  timestamp = formatCardLongDate(task.status.timestamp);
                                                } else {
                                                  timestamp = formatDate(task.status.timestamp, lastUpdate);
                                                }

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
                                                    var hoverString = "Timestamp: " + timestamp + "<br>Duration: " + formatLongDuration(task.status.duration);
                                                    // TODO: Re-add console link
                                                    html.push("<div id=\"" + id + "\" class=\"status stage-minimalist-task " +
                                                        "\"><div class=\"task-content-minimalist\">" +
                                                        "<div class=\"task-header\"><div class=\"taskname-minimalist\"><a id=\"" + getStageId(stage.id + "", i) + "\" class=\"circle_" + task.status.type + "\"><br><span class=\"tooltip\">" + hoverString + "</span></a></div>");
                                                    html.push("</div></div></div>");
                                                } else {
                                                    html.push("<div id=\"" + id + "\" class=\"status stage-task " + // task.status.type +
                                                        "\"><div class=\"task-progress " + progressClass + "\" style=\"width: " + progress + "%;\"><div class=\"task-content\">" +
                                                        "<div class=\"task-header\"><div class=\"taskname\"></div>");
                                                    if (data.allowManualTriggers && task.manual && task.manualStep.enabled && task.manualStep.permission) {
                                                        html.push('<div class="task-manual" id="manual-' + id + '" title="Trigger manual build" onclick="triggerManual(\'' + id + '\', \'' + task.id + '\', \'' + task.manualStep.upstreamProject + '\', \'' + task.manualStep.upstreamId + '\', \'' + view.viewUrl + '\');">');
                                                        html.push("</div>");
                                                    } else {
                                                        if (!pipeline.aggregated && data.allowRebuild && task.rebuildable) {
                                                            html.push('<div class="task-rebuild" id="rebuild-' + id + '" title="Trigger rebuild" onclick="triggerRebuild(\'' + id + '\', \'' + task.id + '\', \'' + task.buildId + '\', \'' + view.viewUrl + '\');">');
                                                            html.push("</div>");
                                                        }
                                                    }

                                                    html.push('</div><div class="task-details">');
                                                    if (timestamp != "") {
                                                        html.push("<div class='console'><a href=\"" + getLink(data, task.link) + consoleLogLink + "\">" + taskHeader + "</a></div>");
                                                    }

                                                    html.push('</div><div class="task-details">');
                                                    if (timestamp != "") {
                                                        html.push("<div id=\"" + id + ".timestamp\" class='timestamp'>" + timestamp + "</div>");
                                                    }

                                                    html.push('</div><div class="task-details">');
                                                    if (task.status.duration >= 0) {
                                                        html.push("<div class='duration'>" + formatDuration(task.status.duration) + "</div>");
                                                    }

                                                    html.push("</div></div></div></div>");

                                                    html.push(generateDescription(data, task));
                                                    html.push(generateTestInfo(data, task));
                                                    html.push(generateStaticAnalysisInfo(data, task));
                                                    html.push(generatePromotionsInfo(data, task));
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
                                            getDisplayValues(data.displayArguments, pipeline, jobName, pipeline.version.substring(1));
                                        }

                                        html.push('</div>');
                                        html.push("</section>");

                                        html.push('</div>');
                                    }

                                    html.push("</section>");
                                    Q("#" + divNames[c % divNames.length]).append(html.join(""));
                                    Q("#pipeline-message-" + pipelineid).html('');
                                }

                                // Update all the manifest information at the end to minimize number of calls required
                                if (data.showManifestInfo && (data.manifestJobName != "")) {
                                    getManifestInfo(data.manifestJobName, clManifestMap);
                                }

                                var index = 0, source, target;
                                var anchors, connector = [];
                                lastResponse = data;
                                equalheight(".pipeline-row .stage");

                                Q.each(data.pipelines, function (i, component) {
                                    Q.each(component.pipelines, function (j, pipeline) {
                                        index = j;
                                        Q.each(pipeline.stages, function (k, stage) {
                                            if (stage.downstreamStages) {

                                                if (data.viewMode == "Minimalist") {
                                                    anchors = [[1, 0, 1, 0, 0, 12], [0, 0, -1, 0, 0, 12]];
                                                    connector = ["Flowchart", { stub: 50, gap: 0, midpoint: 0, alwaysRespectStubs: true } ];
                                                } else {
                                                    anchors = [[1, 0, 1, 0, 0, 37], [0, 0, -1, 0, 0, 37]];
                                                    connector = ["Flowchart", { stub: 25, gap: 2, midpoint: 1, alwaysRespectStubs: true } ];
                                                }

                                                Q.each(stage.downstreamStageIds, function (l, value) {
                                                    source = getStageId(stage.id + "", index);
                                                    target = getStageId(value + "", index);
                                                    jsplumb.connect({
                                                        source: source,
                                                        target: target,
                                                        anchors: anchors, // allow boxes to increase in height but keep anchor lines on the top
                                                        overlays: [
                                                            //[ "Arrow", { location: 1, foldback: 0.9, width: 12, length: 12}]
                                                            [ "Arrow", { location: 1, foldback: 0.9, width: 1, length: 12}]
                                                        ],
                                                        cssClass: "relation",
                                                        connector: connector,
                                                        paintStyle: { lineWidth: 2, strokeStyle: "rgba(118,118,118,1)" },
                                                        endpoint: ["Blank"]
                                                    });
                                                });
                                            }
                                        });
                                    });
                                });

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
                        }
}

function redrawConnections() {
    instance.repaintEverything();
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
function getUSTimezone(timezone) {
    var timezones = '{}';
    var today = new Date();

    // Account for daylight savings time
    if (today.dst()) {
        timezones = JSON.parse('{"GMT-0700": "PDT", "GMT-0600": "MDT", "GMT-0500": "CDT","GMT-0400": "EDT"}');
    }
    else {
        timezones = JSON.parse('{"GMT-0800": "PST", "GMT-0700": "MST", "GMT-0600": "CST","GMT-0500": "EST"}');
    }

    // For other parts in the world
    if (timezones.hasOwnProperty(timezone) != true) {
        return timezone;
    }

    return timezones[timezone];
}

function formatLongDate(date) {
  if (date != null) {
    // No moment method to get the timezone so we'll do it ourselves
    var dateString = moment(date, "YYYY-MM-DDTHH:mm:ss").toString();
    var timezoneString = getUSTimezone(dateString.split(' ')[5]);
    var hourString = dateString.split(' ')[4];
    var hour = hourString.split(':')[0];
    var timeOfDayString = "AM";

    if (parseInt(hour) > 12) {
        timeOfDayString = "PM";
        hourString = (parseInt(hour) - 12).toString() + ':' + hourString.split(':').slice(1).join(':');
    }

    dateString = moment(date, "YYYY-MM-DDTHH:mm:ss").toString().split(' ').slice(0, 4).join(' ') + " " + hourString + " " + timeOfDayString + " " + timezoneString;
    return dateString;
  }
  return "";
}

function formatCardLongDate(date) {
  if (date != null) {
    return moment(date, "YYYY-MM-DDTHH:mm:ss").toString().split(' ').slice(1, 5).join(' ');
  }
  return "";
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
    return "never started";
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
 * Get all artifacts for a build.
 */
function getBuildArtifacts(taskId, buildNum) {
    var artifacts = [];
    Q.ajax({
        url: rootURL + "/job/" + taskId + "/" + buildNum + "/api/json?tree=artifacts[*]",
        type: "GET",
        dataType: 'json',
        async: false,
        cache: true,
        timeout: 20000,
        success: function (json) {
            var data = json.artifacts;
            if (data.length > 0) {
                for (var i=0; i<data.length; i++) {
                    artifacts.push(data[i].fileName);
                }
            }
        },
        error: function (xhr, status, error) {
        }
    })
    return artifacts;
}

function getBuildArtifactLinks(taskId, buildNum) {
    var artifacts = getBuildArtifacts(taskId, buildNum);

    if (artifacts.length == 0) {
      return "No artifacts found";
    }

    var retVal = "";

    if (artifacts.length > 0) {
        for (var i=0; i<artifacts.length; i++) {
            var artifactInfo = "";
            Q.ajax({
                url: rootURL + "/job/" + taskId + "/" + buildNum + "/artifact/" + artifacts[i],
                type: "GET",
                async: false,
                cache: true,
                timeout: 20000,
                success: function (json) {
                    artifactInfo = json;
                },
                error: function (xhr, status, error) {
                }
            })

            retVal += "<a href=\"http://localhost:8080/job/" + taskId + "/" + buildNum + "/artifact/" + artifacts[i] + "\">" + htmlEncode(artifacts[i]) +
            "<span class=\"tooltip\">" + artifactInfo + "</span></a>, "
        }
        retVal = retVal.substring(0, retVal.length - 2);
    }

    return retVal;
}

/**
 * Generate an table of specified display values
 */
function generateDisplayValueTable(displayArgs, pipelineName, pipelineNum) {
    var displayArgsJson;

    try {
        displayArgsJson = JSON.parse(displayArgs);
    }
    catch (err) {
        return "INVALID JSON"
    }

    var retVal = "";

    for (var mainProject in displayArgsJson) {
        if (mainProject == pipelineName) {
            var mainProjectDisplayConfig = displayArgsJson[mainProject];

            for (var displayKey in mainProjectDisplayConfig) {
                var displayKeyConfig = mainProjectDisplayConfig[displayKey];
                var projectName = "";
                if (displayKeyConfig.hasOwnProperty("projectName")) {
                    projectName = displayKeyConfig.projectName;
                }

                var id = mainProject + "-" + getStageId(displayKey, pipelineNum) + "-" + projectName;
                retVal += "<tr><th>" + displayKey + "</th><td id=\"" + id + "\">Value not found across pipeline</td></tr>";    
            }    
        }
    }
    return retVal;
}

/**
 * Load the displayed values
 */
function loadDisplayValues(displayArgs, pipelineName, pipelineNum, savedPipelineDisplayValues) {
    var displayArgsJson;

    try {
        displayArgsJson = JSON.parse(displayArgs);
    }
    catch (err) {
        return "INVALID JSON"
    }

    var retVal = "";

    for (var mainProject in displayArgsJson) {
        if (mainProject == pipelineName) {
            var mainProjectDisplayConfig = displayArgsJson[mainProject];

            for (var displayKey in mainProjectDisplayConfig) {
                var displayKeyConfig = mainProjectDisplayConfig[displayKey];
                var projectName = "";
                if (displayKeyConfig.hasOwnProperty("projectName")) {
                    projectName = displayKeyConfig.projectName;
                }

                var id = mainProject + "-" + getStageId(displayKey, pipelineNum) + "-" + projectName;

                if (savedPipelineDisplayValues.hasOwnProperty(id)) {
                    retVal += "<tr><th>" + displayKey + "</th><td id=\"" + id + "\">" + savedPipelineDisplayValues[id] + "</td></tr>";
                } else {
                    retVal += "<tr><th>" + displayKey + "</th><td id=\"" + id + "\">Value not found across pipeline</td></tr>";
                }
            }
        }
    }
    return retVal;
}

/**
 * Retrieve desired values from any projects along a pipeline
 */
function getDisplayValues(displayArgs, pipeline, pipelineName, pipelineNum) {
    var displayArgsJson;

    try {
        displayArgsJson = JSON.parse(displayArgs);
    }
    catch (err) {
        return;
    }

    var stage;
    var projectNameIdMap = {};
    var updateString = "";
    var retVal = "";

     // Get a mapping of project names to project build ids
     for (var j = 0; j < pipeline.stages.length; j++) {
        stage = pipeline.stages[j];
        projectNameIdMap[stage.name] = stage.tasks[0].buildId;
     }

    for (var mainProject in displayArgsJson) {
        if (mainProject == pipelineName) {
            var mainProjectDisplayConfig = displayArgsJson[mainProject];

            for (var displayKey in mainProjectDisplayConfig) {
                var displayKeyConfig = mainProjectDisplayConfig[displayKey];
                var projectName, filePath, artifactName, envName, paramName, grepPattern;
                projectName = filePath = artifactName = envName = paramName = grepPattern = "";

                if (displayKeyConfig.hasOwnProperty("projectName")) {
                    projectName = displayKeyConfig.projectName;

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

                    // We expect one of the following to be populated so we know where to look
                    if (filePath == "" && artifactName == "" && envName == "" && paramName == "") {
                        continue;
                    }

                    var url = "";
                    if (artifactName != "") {
                        url = "job/" + projectName + "/" + projectNameIdMap[projectName] + "/artifact/" + artifactName;
                    }

                    if (filePath != "") {
                        url = "job/" + projectName + "/ws/" + filePath;
                    }

                    if (envName != "" || paramName != "") {
                        url = "job/" + projectName + "/" + projectNameIdMap[projectName] + "/injectedEnvVars/api/json";
                    }

                    // In the event that somehow we fail to create a URL
                    if (url == "") {
                        continue;
                    }

                    Q.ajax({
                        url: rootURL + "/" + url,
                        type: "GET",
                        async: true,
                        cache: true,
                        timeout: 20000,
                        success: function(data) {
                            updateDisplayValues(data, this.url, displayArgs, pipelineName, pipelineNum);
                        },
                        error: function (xhr, status, error) {
                        }
                    })
                }
            }
        }
        else {
            // We expect a project name for each display value -- otherwise we don't know where to look
            continue;
        }
    }
}

 /**
  * Callback function to update the specified display values
  */
function updateDisplayValues(data, url, displayArgs, pipelineName, pipelineNum) {
    var projectName = (url.split("/job/")[1]).split("/")[0];
    var displayArgsJson = JSON.parse(displayArgs);

    // Check if we are parsing for an environment variable / parameter
    if (url.indexOf("/injectedEnvVars/") != -1) {
        for (var mainProject in displayArgsJson) {
            if (mainProject == pipelineName) {
                var mainProjectDisplayConfig = displayArgsJson[mainProject];

                for (var displayKey in mainProjectDisplayConfig) {
                    var displayKeyConfig = mainProjectDisplayConfig[displayKey];
                    var envName = "";

                    if (displayKeyConfig.hasOwnProperty("projectName")) {
                        if (displayKeyConfig.projectName != projectName) {
                            continue;
                        }
                        if (displayKeyConfig.hasOwnProperty("envName") || displayKeyConfig.hasOwnProperty("paramName")) {
                            if (displayKeyConfig.hasOwnProperty("envName")) {
                                envName = displayKeyConfig.envName;
                            } else {
                                envName = displayKeyConfig.paramName;
                            }
                            
                            if (data.hasOwnProperty("envMap")) {
                                var envMap = data.envMap;

                                if (envMap.hasOwnProperty(envName)) {
                                    var id = pipelineName + "-" + getStageId(displayKey, pipelineNum) + "-" + projectName;
                                    var ele = document.getElementById(id);
                                    ele.innerHTML = envMap[envName];

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
    } else {
        var file;
        var propertyType;
        // Check if we are parsing for a filePath or an artifact
        if (url.indexOf("/ws/") != -1) {
            file = url.split("/ws/")[1];
            propertyType = "filePath";
        } else {
            file = url.split("/artifact/")[1];
            propertyType = "artifactName";
        }

        for (var mainProject in displayArgsJson) {
            if (mainProject == pipelineName) {
                var mainProjectDisplayConfig = displayArgsJson[mainProject];

                for (var displayKey in mainProjectDisplayConfig) {
                    var displayKeyConfig = mainProjectDisplayConfig[displayKey];

                    if (displayKeyConfig.hasOwnProperty("projectName")) {
                        if (displayKeyConfig.projectName != projectName) {
                            continue;
                        }
                        if (displayKeyConfig.hasOwnProperty(propertyType)) {
                            if (displayKeyConfig[propertyType] == file) {
                                var toolTipData = data.replace(/-/g, '&#x2011;');

                                if (displayKeyConfig.hasOwnProperty("grepPattern")) {
                                    var expression = displayKeyConfig.grepPattern;
                                    var grepFlag = 'g';

                                    if (displayKeyConfig.hasOwnProperty("grepFlag")) {
                                        grepFlag = displayKeyConfig.grepFlag;
                                    }

                                    if (expression.charAt(0) == "/" && expression.charAt(expression.length - 1) == "/") {
                                        expression = expression.substring(1, expression.length - 1);
                                    }

                                    var regex = new RegExp(expression, grepFlag);
                                    var match;
                                    var results = [];

                                    while (match = regex.exec(toolTipData)) {
                                        results.push(match[0]);
                                    }
                                    toolTipData = results.join("\n");
                                }

                                var id = pipelineName + "-" + getStageId(displayKey, pipelineNum) + "-" + projectName;
                                var ele = document.getElementById(id);

                                if (displayKeyConfig.hasOwnProperty("flattenValue")) {
                                    if (displayKeyConfig.flattenValue == "true") {
                                        ele.innerHTML = toolTipData;                                        
                                    }
                                } else {
                                    toolTipData = toolTipData.replace(/(?:\r\n|\r|\n)/g, '<br>');
                                    ele.innerHTML = "<a href=\"" + url + "\">" + url.split("/job/")[1] + "<span class=\"tooltip\">" + toolTipData + "</span></a>";    
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
}

function getToggleState(toggleId, toggleType) {
    var toggleStates = JSON.parse(sessionStorage.toggleStates);

    if (toggleType == "block") {
        if (toggleStates.hasOwnProperty(toggleId)) {
            return toggleStates[toggleId];
        } else {
            return "block";
        }
    }

    if (toggleType == "table") {
        if (toggleStates.hasOwnProperty(toggleId)) {
            return toggleStates[toggleId];
        } else {
            return "table";
        }
    }
}

function toggle(toggleBuildId) {
    var toggleStates = JSON.parse(sessionStorage.toggleStates);
    var ele = document.getElementById(toggleBuildId);

    if (ele.style.display == "block") {
        ele.style.display = "none";
        toggleStates[toggleBuildId] = "none";
    } else {
        ele.style.display = "block";
        toggleStates[toggleBuildId] = "block";
    }

    sessionStorage.toggleStates = JSON.stringify(toggleStates);
    redrawConnections();
}

function toggleTable(toggleTableId) {
    var toggleStates = JSON.parse(sessionStorage.toggleStates);
    var ele = document.getElementById(toggleTableId);

    if (ele.style.display == "table") {
        ele.style.display = "none";
        toggleStates[toggleTableId] = "none";
    } else {
        ele.style.display = "table";
        toggleStates[toggleTableId] = "table";
    }

    sessionStorage.toggleStates = JSON.stringify(toggleStates);
    redrawConnections();
}
