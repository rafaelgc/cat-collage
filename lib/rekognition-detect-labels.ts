import { CustomState } from "aws-cdk-lib/aws-stepfunctions";
import { Construct } from "constructs";

export interface RekognitionDetectLabelsProps {
  bucket: string
}

export class RekognitionDetectLabels extends CustomState {
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