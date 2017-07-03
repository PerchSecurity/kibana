/*
This file is a custom perch security written replacement for create_proxy.js.
It was created because there was no way to monkey patch create_proxy and hook into the ES request to set the user's allowed companies for all requests.
It is mostly a mashup of these two files:
https://github.com/elastic/kibana/blob/5.4/src/core_plugins/elasticsearch/lib/create_proxy.js
https://github.com/hapijs/h2o2/blob/master/lib/index.js
*/
import mapUri from './map_uri';
import Wreck from 'wreck';
import Hoek from 'hoek';
import _ from 'lodash';


export function createProxy(server, method, path, config) {
  const proxies = new Map([
    ['/elasticsearch', server.plugins.elasticsearch.getCluster('data')],
    ['/es_admin', server.plugins.elasticsearch.getCluster('admin')]
  ]);

  for (const [proxyPrefix, cluster] of proxies) {
    const options = {
      method,
      path: createPath(proxyPrefix, path),
      config: {
        timeout: {
          socket: cluster.getRequestTimeout()
        },
      },
      handler: server.plugins.elasticsearch.proxyHandler(mapUri(cluster, proxyPrefix))
    };

    if (method !== 'GET' && method !== 'HEAD') {
      //_.set(options, 'config.payload.output', 'stream');
      _.set(options, 'config.payload.parse', false);
    }

    _.assign(options.config, config);
    server.route(options);
  }

}

export function proxyHandler(getUri) {
  //creating a closure here with `handle` as a property allows for monkeypatching
  return function (req, reply) { proxyHandler.handle(getUri, req, reply); };
}

proxyHandler.handle = (getUri, req, reply) => {
  getUri(req, (err, url, headers) => {
    headers = Hoek.merge(req.headers, headers);
    const options = {
      payload: req.payload,
      headers
    };

    Wreck.request(req.method, url, options, (err, res) => {
      if (err) {
        // TODO: need error logging here to slack. Also, this doesn't catch non-2xx status codes and probably should log those too.
        console.log('ERROR RETURNED FROM ES');
        console.log(err);
      }
      //console.log(res.statusCode);
      if (res.headers.location) {
        // TODO: Workaround for #8705 until hapi has been updated to >= 15.0.0
        res.headers.location = encodeURI(res.headers.location);
      }
      return reply(res).code(res.statusCode).passThrough(true);
    });
  });
};

export function createPath(prefix, path) {
  path = path[0] === '/' ? path : `/${path}`;
  prefix = prefix[0] === '/' ? prefix : `/${prefix}`;

  return `${prefix}${path}`;
}
