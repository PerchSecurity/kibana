/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License;
 * you may not use this file except in compliance with the Elastic License.
 */

import { get } from 'lodash';
import { events as esqueueEvents } from './esqueue';
import { oncePerServer } from './once_per_server';

function EnqueueJob(server) {
  this.queueConfig = server.config().get('xpack.reporting.queue');
  this.exportTypesRegistry = server.plugins.reporting.exportTypesRegistry;
  this.jobQueue = server.plugins.reporting.queue;
  this.server = server;
}

EnqueueJob.prototype.getJobQueue = function (index) {
  let q = this.jobQueue;
  if (index) {
    q = Object.create(q);
    q.index = index;
  }
  console.log('AFTER');
  console.log(q.addJob);
  console.log('REPORTING QUEUE AFTER');
  console.log(this.server.plugins.reporting.queue.index);
  return q;
};

EnqueueJob.prototype.job = async function enqueueJob(exportTypeId, jobParams, user, headers, request, index = null) {
  const exportType = this.exportTypesRegistry.getById(exportTypeId);
  const createJob = exportType.createJobFactory(this.server);

  const payload = await createJob(jobParams, headers, request);

  const options = {
    timeout: this.queueConfig.timeout,
    created_by: get(user, 'username', false),
  };

  return new Promise((resolve, reject) => {
    const jobQueue = this.getJobQueue(index);
    const job = jobQueue.addJob(exportType.jobType, payload, options);

    job.on(esqueueEvents.EVENT_JOB_CREATED, (createdJob) => {
      if (createdJob.id === job.id) {
        this.server.log(['reporting', 'debug'], `Saved object to process`);
        resolve(job);
      }
    });
    job.on(esqueueEvents.EVENT_JOB_CREATE_ERROR, reject);
  });
};

const enqueueJobFactory =  oncePerServer(function (server) {
  return new EnqueueJob(server);
});

module.exports = {
  EnqueueJob,
  enqueueJobFactory
};
