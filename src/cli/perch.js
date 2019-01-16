/* eslint-disable @kbn/license-header/require-license-header */
/// <reference path="./command.js" />
import os from 'os';

import Wreck from 'wreck';


/**
 * EC2 instance ID or local hostname, depending on availability.
 * See beforeKibanaStart
 *
 * @type {String}
 */
let serverName;


/**
 *
 * @param {Command} program The commander Command instance used to initialize
 *                          the Kibana CLI
 * @return {Promise<void>}
 */
export default async function wrapKibanaCli(program) {
  const serve = program.commands.find(command => command.name() === 'serve');
  const parent = serve.parent || serve;
  const name = parent === serve ? '*' : serve.name();
  parent.prependListener(name, beforeKibanaServerStart);

  return beforeKibanaStart();
}


/**
 * Called before command-line arguments are parsed and executed
 *
 * @return {Promise<void>}
 */
export async function beforeKibanaStart() {
  return (
    Wreck.get(
      'http://instance-data/latest/meta-data/instance-id',
      { timeout: 10 }
    ).then(
      (err, resp, payload) => {
        // We're on an EC2 instance; use the instance ID for server name
        serverName = payload;
      },
      () => {
        // We're outside AWS, perhaps in a dev env; use standard hostname
        serverName = os.hostname();
      }
    ).then(() => {
      enableSentryErrorTracking();
    })
  );
}


/**
 * Called right before the Kibana server starts.
 */
export function beforeKibanaServerStart() {

}


/**
 * Initialize sentry error tracking
 */
export function enableSentryErrorTracking(...clientOptions) {
  const Sentry = require('@sentry/node');
  Sentry.init({
    dsn: 'https://6e4861a4495b4b3eb0981bba1f2c6524@sentry.io/1367239',
    environment: process.env.APP_ENV || 'DEV',
    serverName,
    ...clientOptions,
  });

  const client = Sentry.getCurrentHub().getClient();
  const finalOptions = client.options;
  console.info(`Initialized Sentry with options: ${JSON.stringify(finalOptions)}`);
}
