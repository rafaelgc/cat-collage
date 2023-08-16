import { CfnOutput, CfnParameter, Duration, Stack, StackProps } from 'aws-cdk-lib';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

import * as lambda from 'aws-cdk-lib/aws-lambda';
import { SnsPublish, LambdaInvoke } from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Choice, Condition, CustomState, Pass, StateMachine, Parallel, DefinitionBody, TaskInput, LogLevel } from 'aws-cdk-lib/aws-stepfunctions';
import { BlockPublicAccess, Bucket, BucketAccessControl } from 'aws-cdk-lib/aws-s3';
import { PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Subscription, SubscriptionProtocol } from 'aws-cdk-lib/aws-sns';
import { DockerImageCode, DockerImageFunction } from 'aws-cdk-lib/aws-lambda';
import path = require('path');
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Rule } from 'aws-cdk-lib/aws-events';
import { SfnStateMachine } from 'aws-cdk-lib/aws-events-targets';
import { ReadWriteType, Trail } from 'aws-cdk-lib/aws-cloudtrail';

interface RekognitionDetectLabelsProps {
  bucket: string
}

class RekognitionDetectLabels extends CustomState {
  constructor(scope: Construct, id: string, props: RekognitionDetectLabelsProps) {
    super(scope, id, {
      stateJson: {
        Type: 'Task',
        Resource: 'arn:aws:states:::aws-sdk:rekognition:detectLabels',
        Parameters: {
          "Image": {
            "S3Object": {
              "Bucket": props.bucket,
              "Name.$": "$.image"
            }
          },
          "Settings": {
            "GeneralLabels": {
              "LabelInclusionFilters": [
                "Cat"
              ]
            }
          }
        },
        ResultPath: '$.rekognitionOutput'
      }
    });
  }
}


export class NodeStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const notificationPhoneNumber = new CfnParameter(this, "NotificationPhone", {
      type: "String",
      description: "Phone number to send SMS notifications to"
    });

    // Create the input Bucket. Our users will be able to upload
    // here their pictures and the algoritm will evaluate whether
    // the picture contains a cat or not.
    const inputBucket = new Bucket(this, 'SeeCatsInputs', {
      eventBridgeEnabled: true
    });
    
    // Create the output Bucket. We will store here the collage of cats.
    const outputBucket = new Bucket(this, 'SeeCatsOutput', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ACLS
    });
    outputBucket.grantPublicAccess('collage.png');

    const snsTopic = this.createSNSTopic(notificationPhoneNumber);

    const generateCollageLambdaFunction = this.createLambdaResources(inputBucket, outputBucket);
    
    const stateMachine = this.createStateMachine(generateCollageLambdaFunction, inputBucket, snsTopic);

    this.connectInputBucketToStateMachine(inputBucket, stateMachine);

    new CfnOutput(this, 'Output Bucket URL', { value: outputBucket.bucketRegionalDomainName + '/collage.png' });
  }

  private connectInputBucketToStateMachine(inputBucket: Bucket, stateMachine: StateMachine) {
    // EventBridge rule to trigger the Step Function when a new object is uploaded to the input bucket.
    const rule = new Rule(this, 'RunStepFunctionWhenFileUploaded', {
      eventPattern: {
        source: ['aws.s3'],
        detailType: ['Object Created'],
        detail: {
          bucket: {
            name: [inputBucket.bucketName],
          }
        },
      },
    });

    rule.addTarget(
      new SfnStateMachine(stateMachine)
    );
  }

  private createSNSTopic(notificationPhoneNumber: CfnParameter): sns.Topic {
    // Create an SNS topic
    // We will publish a message to this topic when the uploaded image contains a cat.
    const snsTopic = new sns.Topic(this, 'SeeCatsNotifications');

    if (notificationPhoneNumber.valueAsString.length > 1) {
      new Subscription(this, 'SMSSubscription', {
        topic: snsTopic,
        protocol: SubscriptionProtocol.SMS,
        endpoint: notificationPhoneNumber.valueAsString
      });
    }

    return snsTopic;
  }

  private createLambdaResources(inputBucket: Bucket, outputBucket: Bucket): DockerImageFunction {
    // Log group.
    const logGroup = new LogGroup(this, 'GenerateCollageLogGroup', {
      retention: RetentionDays.ONE_DAY,
    });
    
    // We're going to allow the Lambda function to read from one bucket
    // and to write in the other one.
    const lambdaRole = new Role(this, 'LambdaRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
    });
    lambdaRole.addToPolicy(
      new PolicyStatement({
        actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
        resources: [logGroup.logGroupArn],
      })
    );
    inputBucket.grantRead(lambdaRole);
    outputBucket.grantReadWrite(lambdaRole);

    // Create the Lambda function
    const generateCollageLambdaFunction = new DockerImageFunction(this, 'GenerateCollage', {
      code: DockerImageCode.fromImageAsset(path.join(__dirname, '/../generate-collage')),
      environment: {
        'INPUT_BUCKET': inputBucket.bucketName,
        'OUTPUT_BUCKET': outputBucket.bucketName
      },
      role: lambdaRole,
      timeout: Duration.seconds(30),
      memorySize: 256
    });

    return generateCollageLambdaFunction;
  }

  private createStateMachine(
    generateCollageLambdaFunction: DockerImageFunction,
    inputBucket: Bucket,
    snsTopic: sns.Topic
  ): StateMachine {
    // The Step Function needs to read from the input bucket, call
    // Rekognition to detect labels and send messages to SNS. So we're
    // going to create an IAM role that allows it to do that.
    const stepFunctionRole = new Role(this, 'StepFunctionRole', {
      assumedBy: new ServicePrincipal('states.amazonaws.com')
    });

    generateCollageLambdaFunction.grantInvoke(stepFunctionRole);
    inputBucket.grantRead(stepFunctionRole);
    snsTopic.grantPublish(stepFunctionRole);
    stepFunctionRole.addToPolicy(new PolicyStatement({
      actions: ['rekognition:DetectLabels'],
      resources: ['*']
    }));
    
    // Final states:
    const noCatNotification = new SnsPublish(this, 'Send no cat notification', {
      topic: snsTopic,
      message: TaskInput.fromText('No cat!')
    });

    const catFoundParallelActions = new Parallel(this, 'Parallel').branch(
      new SnsPublish(this, 'Send cat notification', {
        topic: snsTopic,
        message: TaskInput.fromText('Cat!')
      })
    ).branch(
      new LambdaInvoke(this, 'Invoke Generate Collage', {
        lambdaFunction: generateCollageLambdaFunction
      })
    );

    // Initial state:
    const transformInput = new Pass(this, 'Transform Input', {
      parameters: {
        "image.$": "$.detail.object.key"
      },
    });
    
    // Other states:
    const detectLabels = new RekognitionDetectLabels(this, 'DetectLabels', {
      bucket: inputBucket.bucketName
    });

    const checkHasCat = new Choice(this, 'Check Cats').when(
      Condition.stringEquals('$.rekognitionOutput.Labels[0].Name', 'Cat'), catFoundParallelActions
    ).otherwise(noCatNotification);
    
    const definition =
      transformInput.next(
        detectLabels.next(
          new Choice(this, 'Has results?')
            .when(Condition.isPresent('$.rekognitionOutput.Labels[0]'), checkHasCat)
            .otherwise(noCatNotification)
    ));

    const stateMachine = new StateMachine(this, 'SeeCats', {
      stateMachineName: 'SeeCats',
      definitionBody: DefinitionBody.fromChainable(definition),
      timeout: Duration.minutes(5),
      comment: 'a super cool state machine',
      role: stepFunctionRole,
      logs: {
        destination: new LogGroup(this, 'SeeCatsLogs', {
          retention: RetentionDays.ONE_DAY
        }),
        level: LogLevel.ALL,
        includeExecutionData: true
      }
    });

    return stateMachine;
  }
}

