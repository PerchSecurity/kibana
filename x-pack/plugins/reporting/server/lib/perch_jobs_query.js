/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License;
 * you may not use this file except in compliance with the Elastic License.
 */

import { get } from 'lodash';
import { QUEUE_DOCTYPE } from '../../common/constants';
import { oncePerServer } from './once_per_server';

const defaultSize = 10;

function JobsQuery(server) {
  const { callWithInternalUser, errors: esErrors } = server.plugins.elasticsearch.getCluster('admin');
  this.index = server.plugins.reporting.queue.index;
  this.getUsername = (user) => {
    return get(user, 'username', false);
  };

  this.execQuery = (type, body, userReportingIndex = null) => {
    const index = userReportingIndex || this.index;

    const defaultBody = {
      search: {
        _source: {
          excludes: [ 'output.content' ]
        },
        sort: [
          { created_at: { order: 'desc' } }
        ],
        size: defaultSize,
      }
    };

    const query = {
      index: `${index}-*`,
      type: QUEUE_DOCTYPE,
      body: Object.assign(defaultBody[type] || {}, body)
    };

    return callWithInternalUser(type, query)
      .catch((err) => {
        if (err instanceof esErrors['401']) return;
        if (err instanceof esErrors['403']) return;
        if (err instanceof esErrors['404']) return;
        throw err;
      });
  };

  this.getHits = (query) => {
    return query.then((res) => get(res, 'hits.hits', []));
  };

}


JobsQuery.prototype.list = function (headers, jobTypes, user, page = 0, size = defaultSize, jobIds, userReportingIndex = null) {
  const username = this.getUsername(user);

  const body = {
    size,
    from: size * page,
    query: {
      constant_score: {
        filter: {
          bool: {
            must: [
              { terms: { jobtype: jobTypes } },
              { term: { created_by: username } },
            ]
          }
        }
      }
    },
  };

  if (jobIds) {
    body.query.constant_score.filter.bool.must.push({
      ids: { type: QUEUE_DOCTYPE, values: jobIds }
    });
  }

  return this.getHits(this.execQuery('search', body, userReportingIndex));
};

JobsQuery.prototype.count = function (headers, jobTypes, user, userReportingIndex = null) {
  const username = this.getUsername(user);

  const body = {
    query: {
      constant_score: {
        filter: {
          bool: {
            must: [
              { terms: { jobtype: jobTypes } },
              { term: { created_by: username } },
            ]
          }
        }
      }
    }
  };

  return this.execQuery('count', body, userReportingIndex)
    .then((doc) => {
      if (!doc) return 0;
      return doc.count;
    });
};

JobsQuery.prototype.get = function (headers, user, id, opts = {}, userReportingIndex = null) {
  if (!id) return Promise.resolve();

  const username = this.getUsername(user);

  const body = {
    query: {
      constant_score: {
        filter: {
          bool: {
            must: [
              { term: { _id: id } },
              { term: { created_by: username } }
            ],
          }
        }
      }
    },
    size: 1,
  };

  if (opts.includeContent) {
    body._source = {
      excludes: []
    };
  }

  return this.getHits(this.execQuery('search', body, userReportingIndex))
    .then((hits) => {
      if (hits.length !== 1) return;
      return hits[0];
    });
};

const jobsQueryFactory = oncePerServer(server => new JobsQuery(server));


module.exports = {
  JobsQuery,
  jobsQueryFactory
};
