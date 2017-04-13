/*
This file is part of Delivery Pipeline Plugin.

Delivery Pipeline Plugin is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

Delivery Pipeline Plugin is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with Delivery Pipeline Plugin.
If not, see <http://www.gnu.org/licenses/>.
*/
package uw.iyyuan.jenkins.timeline.domain;

import static com.google.common.base.Objects.toStringHelper;
import static com.google.common.base.Strings.isNullOrEmpty;
import static com.google.common.collect.Iterables.concat;
import static com.google.common.collect.Lists.newArrayList;
import static com.google.common.collect.Maps.newLinkedHashMap;
import static java.util.Collections.singleton;

import com.google.common.collect.ImmutableList;
import com.google.common.collect.Lists;
import com.google.common.collect.Maps;
import hudson.Util;
import hudson.model.AbstractBuild;
import hudson.model.AbstractProject;
import hudson.model.Descriptor;
import hudson.model.ItemGroup;
import hudson.model.Project;
import hudson.model.Result;
import hudson.plugins.parameterizedtrigger.BlockableBuildTriggerConfig;
import hudson.plugins.parameterizedtrigger.SubProjectsAction;
import hudson.plugins.parameterizedtrigger.TriggerBuilder;
import hudson.plugins.promoted_builds.PromotedProjectAction;
import hudson.plugins.promoted_builds.PromotionCondition;
import hudson.plugins.promoted_builds.PromotionConditionDescriptor;
import hudson.plugins.promoted_builds.PromotionProcess;
import hudson.plugins.promoted_builds.conditions.DownstreamPassCondition;
import hudson.tasks.BuildStep;
import hudson.tasks.BuildTrigger;
import hudson.tasks.Publisher;
import hudson.util.DescribableList;
import hudson.util.RunList;
import jenkins.model.Jenkins;
import org.jenkinsci.plugins.conditionalbuildstep.ConditionalBuildStepHelper;
import org.jenkinsci.plugins.conditionalbuildstep.ConditionalBuilder;
import org.jenkinsci.plugins.conditionalbuildstep.singlestep.SingleConditionalBuilder;
import org.jenkinsci.plugins.postbuildscript.PostBuildScript;
import org.jgrapht.DirectedGraph;
import org.jgrapht.alg.CycleDetector;
import org.jgrapht.graph.SimpleDirectedGraph;
import org.kohsuke.stapler.export.Exported;
import org.kohsuke.stapler.export.ExportedBean;
import uw.iyyuan.jenkins.timeline.PipelineProperty;
import uw.iyyuan.jenkins.timeline.domain.task.Task;
import uw.iyyuan.jenkins.timeline.util.BuildUtil;
import uw.iyyuan.jenkins.timeline.util.PipelineUtils;
import uw.iyyuan.jenkins.timeline.util.ProjectUtil;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedList;
import java.util.List;
import java.util.Map;
import java.util.Queue;
import java.util.Set;
import javax.annotation.CheckForNull;

@ExportedBean(defaultVisibility = AbstractItem.VISIBILITY)
public class Stage extends AbstractItem {
    private final List<Task> tasks;
    private List<Task> previousTasks;

    private String version;
    private int row;
    private int column;
    private Map<String, List<String>> taskConnections;
    private List<String> downstreamStages;
    private List<Long> downstreamStageIds;
    private final long id;
    private Set<Change> changes = new HashSet<Change>();
    private List<String> blockingJobs;
    private List<String> conditionalJobs;
    private List<String> downstreamJobs;
    private String promotionCriteriaJobs;
    private String promotionTriggerJobs;

    // Used for mapping of stages
    private int nextBlockingColumn = -1;

    public Stage(String name, List<Task> tasks) {
        super(name);
        this.tasks = ImmutableList.copyOf(tasks);
        this.id = PipelineUtils.getRandom();
    }

    public Stage(String name, List<Task> tasks, List<String> blockingJobs, List<String> conditionalJobs, 
                 List<String> downstreamJobs) {
        super(name);
        this.tasks = ImmutableList.copyOf(tasks);
        this.id = PipelineUtils.getRandom();
        this.blockingJobs = blockingJobs;
        this.conditionalJobs = conditionalJobs;
        this.downstreamJobs = downstreamJobs;
    }

    public Stage(String name, List<Task> tasks, List<String> blockingJobs, List<String> conditionalJobs, 
                 List<String> downstreamJobs, String promotionCriteriaJobs, String promotionTriggerJobs) {
        super(name);
        this.tasks = ImmutableList.copyOf(tasks);
        this.id = PipelineUtils.getRandom();
        this.blockingJobs = blockingJobs;
        this.conditionalJobs = conditionalJobs;
        this.downstreamJobs = downstreamJobs;
        this.promotionCriteriaJobs = promotionCriteriaJobs;
        this.promotionTriggerJobs = promotionTriggerJobs;
    }

    private Stage(Stage stage, List<Task> tasks, String version, long id) {
        this(stage.getName(), tasks, new ArrayList<Task>(), stage.getDownstreamStages(), stage.getDownstreamStageIds(),
             stage.getTaskConnections(), version, stage.getRow(), stage.getColumn(), id, stage.getBlockingJobs(),
             stage.getConditionalJobs(), stage.getDownstreamJobs(), stage.getPromotionCriteriaJobs(),
             stage.getPromotionTriggerJobs());
    }

    private Stage(Stage stage, List<Task> tasks, List<Task> previousTasks, String version, long id) {
        this(stage.getName(), tasks, previousTasks, stage.getDownstreamStages(), stage.getDownstreamStageIds(),
             stage.getTaskConnections(), version, stage.getRow(), stage.getColumn(), id, stage.getBlockingJobs(),
             stage.getConditionalJobs(), stage.getDownstreamJobs(), stage.getPromotionCriteriaJobs(),
             stage.getPromotionTriggerJobs());
    }

    private Stage(String name, List<Task> tasks, List<Task> previousTasks, List<String> downstreamStages, 
                  List<Long> downstreamStageIds, Map<String, List<String>> taskConnections, String version, int row, 
                  int column, long id, List<String> blockingJobs, List<String> conditionalJobs, 
                  List<String> downstreamJobs, String promotionCriteriaJobs, String promotionTriggerJobs) {
        super(name);
        this.tasks = tasks;
        this.previousTasks = previousTasks;
        this.version = version;
        this.row = row;
        this.column = column;
        this.downstreamStages = downstreamStages;
        this.taskConnections = taskConnections;
        this.downstreamStageIds = downstreamStageIds;
        this.id = id;
        this.blockingJobs = blockingJobs;
        this.conditionalJobs = conditionalJobs;
        this.downstreamJobs = downstreamJobs;
        this.promotionCriteriaJobs = promotionCriteriaJobs;
        this.promotionTriggerJobs = promotionTriggerJobs;
    }

    @Exported
    public List<Task> getTasks() {
        return tasks;
    }

    @Exported
    public List<Task> getPreviousTasks() {
        return previousTasks;
    }

    @Exported
    public String getVersion() {
        return version;
    }

    @Exported
    public int getRow() {
        return row;
    }

    public void setRow(int row) {
        this.row = row;
    }

    @Exported
    public int getColumn() {
        return column;
    }

    public void setColumn(int column) {
        this.column = column;
    }

    @Exported
    public List<String> getDownstreamStages() {
        return downstreamStages;
    }

    public void setDownstreamStages(List<String> downstreamStages) {
        this.downstreamStages = downstreamStages;
    }

    @Exported
    public Map<String, List<String>> getTaskConnections() {
        return taskConnections;
    }

    @Exported
    public long getId() {
        return id;
    }

    @Exported
    public List<Long> getDownstreamStageIds() {
        return downstreamStageIds;
    }

    public void setDownstreamStageIds(List<Long> downstreamStageIds) {
        this.downstreamStageIds = downstreamStageIds;
    }

    @Exported
    public Set<Change> getChanges() {
        return changes;
    }

    public void setChanges(Set<Change> changes) {
        this.changes = changes;
    }

    @Exported
    public List<String> getBlockingJobs() {
        return blockingJobs;
    }

    public void setBlockingJobs(List<String> blockingJobs) {
        this.blockingJobs = blockingJobs;
    }

    @Exported
    public List<String> getConditionalJobs() {
        return conditionalJobs;
    }

    public void setConditionalJobs(List<String> conditionalJobs) {
        this.conditionalJobs = conditionalJobs;
    }

    @Exported
    public List<String> getDownstreamJobs() {
        return downstreamJobs;
    }

    public void setDownstreamJobs(List<String> downstreamJobs) {
        this.downstreamJobs = downstreamJobs;
    }

    @Exported
    public String getPromotionCriteriaJobs() {
        return promotionCriteriaJobs;
    }

    public void setPromotionCriteriaJobs(String promotionCriteriaJobs) {
        this.promotionCriteriaJobs = promotionCriteriaJobs;
    }

    @Exported
    public String getPromotionTriggerJobs() {
        return promotionTriggerJobs;
    }

    public void setPromotionTriggerJobs(String promotionTriggerJobs) {
        this.promotionTriggerJobs = promotionTriggerJobs;
    }

    public int getNextBlockingColumn() {
        return nextBlockingColumn;
    }

    public void setNextBlockingColumn(int nextBlockingColumn) {
        this.nextBlockingColumn = nextBlockingColumn;
    }

    public void setTaskConnections(Map<String, List<String>> taskConnections) {
        this.taskConnections = taskConnections;
    }

    public static Stage getPrototypeStage(String name, List<Task> tasks) {
        return new Stage(name, tasks);
    }

    public static Stage getPrototypeStage(String name, List<Task> tasks, List<String> blockingJobs, 
                                          List<String> conditionalJobs, List<String> downstreamJobs) {
        return new Stage(name, tasks, blockingJobs, conditionalJobs, downstreamJobs);
    }

    public static Stage getPrototypeStage(String name, List<Task> tasks, List<String> blockingJobs, 
                                          List<String> conditionalJobs, List<String> downstreamJobs, 
                                          String promotionCriteriaJobs, String promotionTriggerJobs) {
        return new Stage(name, tasks, blockingJobs, conditionalJobs, downstreamJobs, promotionCriteriaJobs, 
                promotionTriggerJobs);
    }

    public static List<Stage> extractStages(AbstractProject firstProject, AbstractProject lastProject)
            throws PipelineException {
        Map<String, Stage> stages = newLinkedHashMap();
        for (AbstractProject project : ProjectUtil.getAllDownstreamProjects(firstProject, lastProject).values()) {
            Task task = Task.getPrototypeTask(project, project.getFullName().equals(firstProject.getFullName()));
            /* if current project is last we need clean downStreamTasks*/
            if (lastProject != null && project.getFullName().equals(lastProject.getFullName())) {
                task.getDownstreamTasks().clear();
            }

            List<String> blockingJobs = getBlockingJobsForStage(project);
            List<String> conditionalJobs = getConditionalJobsForStage(project);
            List<String> downstreamJobs = getDownstreamJobsForStage(project);
            String promotionCriteriaJobs = "";
            String promotionTriggerJobs = "";

            // Mark the promotion criteria jobs and the builds to trigger upon a promotion
            for (PromotedProjectAction action : Util.filter(project.getActions(), PromotedProjectAction.class)) {
                for (PromotionProcess pp : action.getProcesses()) {

                    DescribableList<PromotionCondition,PromotionConditionDescriptor> conditions = pp.conditions;

                    // Check for downstream criteria jobs
                    for (PromotionCondition pc : conditions) {
                        if (pc instanceof DownstreamPassCondition) {
                            promotionCriteriaJobs += ((DownstreamPassCondition) pc).getJobs();
                        }

                        // if (pc instanceof UpstreamPromotionCondition) {
                        //     promotionCriteriaJobs += ((UpstreamPromotionCondition) pc).getRequiredPromotionNames();
                        // }
                    }

                    for (BuildStep bs : pp.getBuildSteps()) {
                        if (bs instanceof TriggerBuilder) {
                            for (BlockableBuildTriggerConfig config : TriggerBuilder.class.cast(bs).getConfigs()) {
                                promotionTriggerJobs += config.getProjects() + ", ";
                            }
                        } else if (bs instanceof BuildTrigger) {
                            for (AbstractProject projectToPromote : BuildTrigger.class.cast(bs).getChildProjects(
                                    project)) {
                                promotionTriggerJobs += projectToPromote.getFullName() + ", ";
                            }
                        }
                    }
                }
            }

            // Get the post build script
            DescribableList<Publisher, Descriptor<Publisher>> publishers = 
                (DescribableList<Publisher, Descriptor<Publisher>>) project.getPublishersList();

            // Mark the jobs in the post build script as conditional/blocking as needed
            if (publishers != null) {
                for (Publisher publisher : publishers) {
                    if (publisher instanceof PostBuildScript) {
                        List<BuildStep> postBuildSteps = ((PostBuildScript) publisher).getBuildSteps();

                        for (BuildStep bs : postBuildSteps) {
                            // Conditional steps (single) or (multiple) 
                            if (bs instanceof ConditionalBuilder) {
                                List<BuildStep> cbs = ((ConditionalBuilder) bs).getConditionalbuilders();

                                if (cbs != null) {
                                    for (BuildStep buildStep : cbs) {
                                        if (TriggerBuilder.class.isInstance(buildStep)) {
                                            for (BlockableBuildTriggerConfig config : TriggerBuilder.class.cast(
                                                    buildStep).getConfigs()) {

                                                if (config.getBlock() != null) {
                                                    blockingJobs.add(config.getProjects());
                                                }

                                                conditionalJobs.add(config.getProjects());
                                            }
                                        }
                                    }
                                }
                            // Trigger/call builds on other projects
                            } else if (bs instanceof TriggerBuilder) {
                                for (BlockableBuildTriggerConfig config : TriggerBuilder.class.cast(bs).getConfigs()) {
                                    
                                    if (config.getBlock() != null) {
                                        blockingJobs.add(config.getProjects());
                                    }                                    
                                }
                            }
                        }
                    }
                }
            }

            PipelineProperty property = (PipelineProperty) project.getProperty(PipelineProperty.class);
            if (property == null && project.getParent() instanceof AbstractProject) {
                property = (PipelineProperty) ((AbstractProject)
                        project.getParent()).getProperty(PipelineProperty.class);
            }
            String stageName = property != null && !isNullOrEmpty(property.getStageName())
                    ? property.getStageName() : project.getDisplayName();
            Stage stage = stages.get(stageName);
            if (stage == null) {
                stage = Stage.getPrototypeStage(stageName, Collections.<Task>emptyList(), blockingJobs, 
                                                conditionalJobs, downstreamJobs, promotionCriteriaJobs, 
                                                promotionTriggerJobs);
            }
            stages.put(stageName,
                    Stage.getPrototypeStage(stage.getName(), newArrayList(concat(stage.getTasks(), singleton(task))),
                                            blockingJobs, conditionalJobs, downstreamJobs, promotionCriteriaJobs,
                                            promotionTriggerJobs));
        }
        Collection<Stage> stagesResult = stages.values();

        return Stage.placeStages(firstProject, stagesResult);
    }


    public Stage createAggregatedStage(ItemGroup context, AbstractProject firstProject) {
        List<Task> stageTasks = new ArrayList<Task>();

        //The version build for this stage is the highest first task build
        AbstractBuild versionBuild = getHighestBuild(firstProject, context);

        String stageVersion = null;
        if (versionBuild != null) {
            stageVersion = versionBuild.getDisplayName();
        }
        for (Task task : getTasks()) {
            stageTasks.add(task.getAggregatedTask(versionBuild, context));
        }
        return new Stage(this, stageTasks, stageVersion, id);
    }

    public Stage createLatestStage(ItemGroup context, AbstractBuild firstBuild) {
        List<Task> stageTasks = new ArrayList<Task>();
        List<Task> previousStageTasks = new ArrayList<Task>();

        for (Task task : getTasks()) {
            stageTasks.add(task.getLatestTask(context, firstBuild));

            final List<Task> previousTasks = task.getAllTriggeredTasks(context, firstBuild);

            // Get all other builds other than the latest that were triggered by firstBuild
            if (previousTasks.size() > 1) {
                previousStageTasks.addAll(previousTasks.subList(1, previousTasks.size()));
            }

        }
        return new Stage(this, stageTasks, previousStageTasks, null, id);
    }

    // public Stage createLatestStage(ItemGroup context, AbstractBuild firstBuild) {
    //     List<Task> stageTasks = new ArrayList<Task>();
    //     for (Task task : getTasks()) {
    //         stageTasks.add(task.getLatestTask(context, firstBuild));
    //     }
    //     return new Stage(this, stageTasks, null, id);
    // }


    public static List<Stage> placeStages(AbstractProject firstProject, Collection<Stage> stages)
            throws PipelineException {

        Queue<String> promotionCriteriaJobsQueue = new LinkedList<String>();
        Queue<String> promotionTriggerJobsQueue = new LinkedList<String>();

        DirectedGraph<Stage, Edge> graph = new SimpleDirectedGraph<Stage, Edge>(new StageEdgeFactory());
        for (Stage stage : stages) {
            stage.setTaskConnections(getStageConnections(stage, stages));
            graph.addVertex(stage);
            List<Stage> downstreamStages = getDownstreamStagesForStage(stage, stages);
            List<String> downstreamStageNames = new ArrayList<String>();
            List<Long> downstreamStageIds = new ArrayList<Long>();
            for (Stage downstream : downstreamStages) {
                downstreamStageNames.add(downstream.getName());
                downstreamStageIds.add(downstream.getId());
                graph.addVertex(downstream);
                graph.addEdge(stage, downstream, new Edge(stage, downstream));
            }
            stage.setDownstreamStages(downstreamStageNames);
            stage.setDownstreamStageIds(downstreamStageIds);

            if (stage.getPromotionCriteriaJobs() != "" || stage.getPromotionTriggerJobs() != "") {
                promotionCriteriaJobsQueue.add(stage.getPromotionCriteriaJobs());
                promotionTriggerJobsQueue.add(stage.getPromotionTriggerJobs());
            } 

        }

        CycleDetector<Stage, Edge> cycleDetector = new CycleDetector<Stage, Edge>(graph);
        if (cycleDetector.detectCycles()) {
            Set<Stage> stageSet = cycleDetector.findCycles();
            StringBuilder message = new StringBuilder("Circular dependencies between stages: ");
            for (Stage stage : stageSet) {
                message.append(stage.getName()).append(" ");
            }
            throw new PipelineException(message.toString());
        }


        List<List<Stage>> allPaths = findAllRunnablePaths(findStageForJob(firstProject.getRelativeNameFrom(
                Jenkins.getInstance()), stages), graph);
        // Collections.sort(allPaths, new Comparator<List<Stage>>() {
        //     public int compare(List<Stage> stages1, List<Stage> stages2) {
        //         return stages2.size() - stages1.size();
        //     }
        // });

        while (!promotionCriteriaJobsQueue.isEmpty()) {

            final String criteriaJob = promotionCriteriaJobsQueue.poll().replaceAll(", ", "");
            final String triggerJob = promotionTriggerJobsQueue.poll().replaceAll(", ", "");

            Collections.sort(allPaths, new Comparator<List<Stage>>() {
                public int compare(List<Stage> stages1, List<Stage> stages2) {

                    List<String> stages1Names = new ArrayList<String>();
                    List<String> stages2Names = new ArrayList<String>();

                    for (Stage stage : stages1) {
                        stages1Names.add(stage.getName());
                    }

                    for (Stage stage : stages2) {
                        stages2Names.add(stage.getName());
                    }

                    if (stages1Names.contains(triggerJob) && stages2Names.contains(criteriaJob)) {
                        return 1;
                    } else if (stages1Names.contains(criteriaJob) && stages2Names.contains(triggerJob)) {
                        return -1;
                    }

                    return 0;
                }
            });     
        }               

        Set<String> blockingJobs = new HashSet<String>();
        Set<String> completedBlockingJobs = new HashSet<String>();

        for (int row = 0; row < allPaths.size(); row++) {
            List<Stage> path = allPaths.get(row);
            for (int column = 0; column < path.size(); column++) {
                Stage stage = path.get(column);

                if (!stage.getBlockingJobs().isEmpty()) {
                    for (String job : stage.getBlockingJobs()) {
                        blockingJobs.add(job);
                    }
                }
            }
        }

        //for keeping track of which row has an available column
        final Map<Integer,Integer> columnRowMap = Maps.newHashMap();
        final List<Stage> processedStages = Lists.newArrayList();

        // lastRowDiscovered keeps track of the last row written to so that two or more "branches" split from the same
        // node are kept on separate rows
        int lastRowDiscovered = 0;
        int lastColumnDiscovered = 0;

        // The number of rows to offset by due to a project only having one downstream stage that is also
        // a downstream project
        int onlyDownstreamJobOffset = 0;
        boolean pushNextDown = false;

        for (int row = 0; row < allPaths.size(); row++) {
            List<Stage> path = allPaths.get(row);
            boolean allSkipped = true;
            int lastMergeColumn = 0;
            int lastMergeColumnNoShift = 0;

            for (int column = 0; column < path.size(); column++) {
                Stage stage = path.get(column);
                Stage previousStage = (column > 0) ? path.get(column - 1) : path.get(column);

                //skip processed stage since the row/column has already been set
                if (!processedStages.contains(stage)) {
                    allSkipped = false;

                    if (blockingJobs.contains(stage.getName()) && !completedBlockingJobs.contains(stage.getName())) {
                        stage.setColumn(Math.max(Math.max(stage.getColumn(), column), 
                                previousStage.getNextBlockingColumn()));
                        lastMergeColumn = 0;
                        lastMergeColumnNoShift = 0;
                    } else {

                        if (lastMergeColumn != 0) {
                            stage.setColumn(Math.max(Math.max(column, previousStage.getNextBlockingColumn()), 
                                Math.max(previousStage.getNextBlockingColumn() - 1 + column - lastMergeColumnNoShift,
                                    lastMergeColumn + column - lastMergeColumnNoShift)));

                        } else {
                            stage.setColumn(Math.max(column, previousStage.getNextBlockingColumn()));
                        }

                        // Get the column number of the current stage as well as it's column number
                        // defined in the for loop above
                        lastMergeColumn = stage.getColumn();
                        lastMergeColumnNoShift = column;                        
                    }

                    final int effectiveColumn = stage.getColumn();
                    final Integer previousRowForThisColumn = columnRowMap.get(effectiveColumn);
                    //set it to 0 if no previous setting is set; if found, previous value + 1
                    int currentRowForThisColumn = previousRowForThisColumn == null
                            ? 0 : previousRowForThisColumn + 1;

                    if (lastRowDiscovered > currentRowForThisColumn) {
                        //update/set row number in the columnRowMap for this effective column
                        columnRowMap.put(effectiveColumn, lastRowDiscovered);

                        stage.setRow(lastRowDiscovered);

                        processedStages.add(stage);

                        // Check if there are ONLY downstream jobs
                        if (!stage.getDownstreamJobs().isEmpty()
                            && stage.getDownstreamStages().size() == stage.getDownstreamJobs().size()) {
                            pushNextDown = true;
                            onlyDownstreamJobOffset += 1;
                        } else {
                            pushNextDown = false;
                        }

                        lastRowDiscovered = lastRowDiscovered + (pushNextDown ? 1 : 0);
                    } else {
                        //update/set row number in the columnRowMap for this effective column
                        columnRowMap.put(effectiveColumn, currentRowForThisColumn);

                        stage.setRow(currentRowForThisColumn);

                        processedStages.add(stage);

                        // Check if there are ONLY downstream jobs
                        if (!stage.getDownstreamJobs().isEmpty()
                            && stage.getDownstreamStages().size() == stage.getDownstreamJobs().size()) {
                            pushNextDown = true;
                            onlyDownstreamJobOffset += 1;
                        } else {
                            pushNextDown = false;
                        }

                        lastRowDiscovered = currentRowForThisColumn + (pushNextDown ? 1 : 0);
                    }
                } else {
                    lastMergeColumn = stage.getColumn();
                    lastMergeColumnNoShift = column;
                }
                // Mark each blocking job as completed
                if (blockingJobs.contains(stage.getName()) && !completedBlockingJobs.contains(stage.getName())) {

                    stage.setNextBlockingColumn(stage.getColumn() + 1);
                    previousStage.setNextBlockingColumn(stage.getColumn() + 1);

                    Stage currentStage = previousStage;
                    for (int prevColumn = (column > 0) ? column - 1 : column; prevColumn > 0; prevColumn--) {
                        previousStage = path.get(prevColumn - 1);

                        if (previousStage.getBlockingJobs().contains(currentStage.getName())) {
                            previousStage.setNextBlockingColumn(stage.getColumn() + 1);
                        } else {
                            break;
                        }

                        currentStage = previousStage;
                    }

                    completedBlockingJobs.add(stage.getName());
                }
            }

            lastRowDiscovered++;
            pushNextDown = false;
            
            if (allSkipped) {
                lastRowDiscovered--;
            }
        }

        // Readd the promotion criteria and promotion trigger jobs
        for (Stage stage : stages) {
            if (stage.getPromotionCriteriaJobs() != "" || stage.getPromotionTriggerJobs() != "") {
                promotionCriteriaJobsQueue.add(stage.getPromotionCriteriaJobs());
                promotionTriggerJobsQueue.add(stage.getPromotionTriggerJobs());
            }
        }

        // Ensure that all trigger jobs come AFTER the criteria job in a promotion
        while (!promotionCriteriaJobsQueue.isEmpty()) {

            final List<Stage> processedPromotionStages = Lists.newArrayList();
            final String criteriaJob = promotionCriteriaJobsQueue.poll().replaceAll(", ", "");
            final String triggerJob = promotionTriggerJobsQueue.poll().replaceAll(", ", "");

            int criteriaJobColumn = -1;
            int triggerJobColumn = -1;
            int triggerJobColumnNoShift = -1;
            Stage triggerStage = null;

            for (int row = 0; row < allPaths.size(); row++) {
                List<Stage> path = allPaths.get(row);

                for (int column = 0; column < path.size(); column++) {
                    Stage stage = path.get(column);

                    if (stage.getName().equals(criteriaJob)) {
                        criteriaJobColumn = Math.max(stage.getColumn(), stage.getNextBlockingColumn());
                    }

                    if (stage.getName().equals(triggerJob)) {
                        triggerJobColumn = stage.getColumn();
                        triggerJobColumnNoShift = column;
                        triggerStage = stage;
                    }
                }
            }

            for (int row = 0; row < allPaths.size(); row++) {
                List<Stage> path = allPaths.get(row);

                if (triggerStage != null && path.contains(triggerStage)) {

                    if (triggerJobColumn > criteriaJobColumn) {
                        break;
                    }

                    for (int column = 0; column < path.size(); column++) {
                        Stage stage = path.get(column);

                        if (column >= triggerJobColumnNoShift) {
                            if (!processedPromotionStages.contains(stage)) {
                                stage.setColumn(stage.getColumn() + criteriaJobColumn - triggerJobColumn + 1);

                                // Update the stages next blocking column as well
                                if (stage.getNextBlockingColumn() > -1) {
                                    stage.setNextBlockingColumn(stage.getNextBlockingColumn() - 1
                                            + criteriaJobColumn - triggerJobColumn + 1);
                                }
                                processedPromotionStages.add(stage);    
                            }
                        }
                    }
                }
            }
        }
        

        List<Stage> result = new ArrayList<Stage>(stages);

        sortByRowsCols(result);

        return result;
    }

    private static Map<String, List<String>> getStageConnections(Stage stage, Collection<Stage> stages) {
        Map<String, List<String>> result = new HashMap<String, List<String>>();
        for (int i = 0; i < stage.getTasks().size(); i++) {
            Task task = stage.getTasks().get(i);
            for (int j = 0; j < task.getDownstreamTasks().size(); j++) {
                String downstreamTask = task.getDownstreamTasks().get(j);
                Stage target = findStageForJob(downstreamTask, stages);
                if (!stage.equals(target)) {
                    if (result.get(task.getId()) == null) {
                        result.put(task.getId(), new ArrayList<String>(singleton(downstreamTask)));
                    } else {
                        result.get(task.getId()).add(downstreamTask);
                    }
                }
            }
        }
        return result;
    }

    private static List<List<Stage>> findAllRunnablePaths(Stage start, DirectedGraph<Stage, Edge> graph) {
        List<List<Stage>> paths = new LinkedList<List<Stage>>();
        if (graph.outDegreeOf(start) == 0) {
            List<Stage> path = new LinkedList<Stage>();
            path.add(start);
            paths.add(path);
        } else {
            for (Edge edge : graph.outgoingEdgesOf(start)) {
                List<List<Stage>> allPathsFromTarget = findAllRunnablePaths(edge.getTarget(), graph);
                for (List<Stage> path : allPathsFromTarget) {
                    path.add(0, start);
                }
                paths.addAll(allPathsFromTarget);
            }
        }
        return paths;
    }

    protected static void sortByRowsCols(List<Stage> stages) {
        Collections.sort(stages, new Comparator<Stage>() {
            @Override
            public int compare(Stage stage1, Stage stage2) {
                int result = Integer.valueOf(stage1.getRow()).compareTo(stage2.getRow());
                if (result == 0) {
                    return Integer.valueOf(stage1.getColumn()).compareTo(stage2.getColumn());
                } else {
                    return result;
                }
            }
        });
    }

    private static List<Stage> getDownstreamStagesForStage(Stage stage, Collection<Stage> stages) {
        List<Stage> result = newArrayList();
        for (int i = 0; i < stage.getTasks().size(); i++) {
            Task task = stage.getTasks().get(i);
            for (int j = 0; j < task.getDownstreamTasks().size(); j++) {
                String jobName = task.getDownstreamTasks().get(j);
                Stage target = findStageForJob(jobName, stages);
                if (target != null && !target.getName().equals(stage.getName())) {
                    result.add(target);
                }
            }
        }
        return result;
    }

    private static List<String> getBlockingJobsForStage(AbstractProject project) {
        List<String> jobNames = new ArrayList<String>();
        for (SubProjectsAction action : Util.filter(project.getActions(), SubProjectsAction.class)) {
            for (BlockableBuildTriggerConfig config : action.getConfigs()) {
                if (config.getBlock() != null) {
                    jobNames.add(config.getProjects());
                }
            }
        }
        return jobNames;
    }

    private static List<String> getConditionalJobsForStage(AbstractProject project) {
        List<String> jobNames = new ArrayList<String>();
        for (TriggerBuilder trigger : ConditionalBuildStepHelper.getContainedBuilders(project, TriggerBuilder.class)) {
            for (BlockableBuildTriggerConfig config : trigger.getConfigs()) {
                jobNames.add(config.getProjects());
            }
        }
        return jobNames;
    }

    private static List<String> getDownstreamJobsForStage(AbstractProject project) {
        List<String> jobNames = new ArrayList<String>();
        List<AbstractProject> downstreamProjects = project.getDownstreamProjects();
        for (AbstractProject downstreamProject : downstreamProjects) {
            jobNames.add(downstreamProject.getDisplayName());
        }
        return jobNames;
    }

    @CheckForNull
    protected static Stage findStageForJob(String name, Collection<Stage> stages) {
        for (Stage stage : stages) {
            for (int j = 0; j < stage.getTasks().size(); j++) {
                Task task = stage.getTasks().get(j);
                if (task.getId().equals(name)) {
                    return stage;
                }
            }
        }
        return null;

    }

    @CheckForNull
    public AbstractBuild getHighestBuild(AbstractProject firstProject, ItemGroup context) {
        return getHighestBuild(firstProject, context, null);
    }

    @CheckForNull
    public AbstractBuild getHighestBuild(AbstractProject firstProject, ItemGroup context, Result minResult) {
        int highest = -1;
        for (Task task : getTasks()) {
            AbstractProject project = ProjectUtil.getProject(task.getId(), context);
            AbstractBuild firstBuild = getFirstUpstreamBuild(project, firstProject, minResult);
            if (firstBuild != null && firstBuild.getNumber() > highest) {
                highest = firstBuild.getNumber();
            }
        }

        if (highest > 0) {
            return firstProject.getBuildByNumber(highest);
        } else {
            return null;
        }
    }

    @CheckForNull
    private AbstractBuild getFirstUpstreamBuild(AbstractProject<?, ?> project, AbstractProject<?, ?> first,
                                                Result minResult) {
        RunList<? extends AbstractBuild> builds = project.getBuilds();
        for (AbstractBuild build : builds) {
            if (minResult != null && (build.isBuilding() || build.getResult().isWorseThan(minResult))) {
                continue;
            }

            AbstractBuild upstream = BuildUtil.getFirstUpstreamBuild(build, first);
            if (upstream != null && upstream.getProject().equals(first)) {
                return upstream;
            }
        }
        return null;
    }

    @Override
    public String toString() {
        return toStringHelper(this)
                .add("name", getName())
                .add("version", getVersion())
                .add("tasks", getTasks())
                .toString();
    }
}
