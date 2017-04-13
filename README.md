Timeline View Plugin
========================

Timeline View Plugin is a plugin written by Ian Yuan.

It is forked from the [Delivery Pipeline Plugin](https://github.com/Diabol/delivery-pipeline-plugin).
Much of the existing code comes from the Delivery Pipeline plugin and all credit for that code is given to the original authors / contributers.

For info see the [Delivery Pipeline Plugin - Wiki](https://wiki.jenkins-ci.org/display/JENKINS/Delivery+Pipeline+Plugin)


How to contribute
---
Read GitHub's general contribution guidelines: https://guides.github.com/activities/contributing-to-open-source/#contributing

It basically comes down to the following guidelines:
 1. If applicable, create a Jira Issue
    + Make sure a similar issue doesn't already exist
 2. Fork the repo
 3. Contribute and have fun!
 4. Add as much unit testing as possible to any new code changes
    + This will make the code much more easy to maintain and to understand its intent
 5. Make sure your code is well formatted and aligns with the projects code style conventions
 6. Make sure to prefix the commit message with the associated Jira issue number together with a descriptive commit message
 7. If you have multiple commits, please make sure to squash them before creating a pull request
    + It's hard to follow contributions when they are scattered across several commits
 8. Create a pull request to get feedback from the maintainers
    + Add a link to the pull request to the associated Jira issue

Build
---

    mvn install

Run locally
---
    mvn hpi:run

Run function tests
---
    mvn integration-test


Configuring manually triggered jobs
----
**Note:** This requires the Build Pipeline plugin to be installed.

To be able to configure a certain job in the pipeline as a manual step, you have to configure the upstream job that triggers the job which is to be performed manually to be marked as a manual step.

In the Jenkins UI this shows up as a Post-Build Action: Build other projects (manual step), where you configure the name of the job to be manually triggered in the "Downstream Project Names".

If you're creating your jobs with JobDSL, use the following syntax in the publishers section (parameters is optional):

    publishers {
        buildPipelineTrigger('name-of-the-manually-triggered-job') {
            parameters {
                propertiesFile('env.${BUILD_NUMBER}.properties')
            }
        }
    }

In your pipeline configuration, make sure to enable manual triggers. The manual triggers (a play button) will not be shown in the UI for aggregate pipelines, only for pipeline instances. If you want to access manual triggers from the UI, make sure to show at least one pipeline instance.



For Jenkins Job Builder job configuration examples, see: [demo.yaml](https://github.com/iyyuan2/delivery-pipeline-plugin/blob/master/examples/demo.yaml)

For JobDSL job configuration examples, see: [demo.groovy](https://github.com/iyyuan2/delivery-pipeline-plugin/blob/master/examples/demo.groovy)
