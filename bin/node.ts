#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { NodeStack } from '../lib/node-stack';

const app = new cdk.App();
new NodeStack(app, 'NodeStack');
