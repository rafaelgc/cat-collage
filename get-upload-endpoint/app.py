import os
import boto3
import random
import string
import json
from botocore.exceptions import ClientError

def generate_random_string(length):
    letters = string.ascii_lowercase
    return ''.join(random.choice(letters) for _ in range(length))

def handler(event, context):
    # Get the S3 bucket name from the environment variable
    bucket_name = os.environ.get('INPUT_BUCKET')
    if not bucket_name:
        return {
            'statusCode': 500,
            'body': 'Missing INPUT_BUCKET environment variable'
        }
    
    # Get the file extension from the event parameters
    query_parameters = event.get('queryStringParameters', {})
    extension = query_parameters.get('extension', 'jpg')
    mime = query_parameters.get('mime', 'image/jpeg')
    
    # Generate a random filename
    random_filename = generate_random_string(10) + '.' + extension
    
    # Generate a presigned URL for S3 object upload
    s3_client = boto3.client('s3')
    try:
        object_key = random_filename
        presigned_url = s3_client.generate_presigned_url(
            'put_object',
            Params={'Bucket': bucket_name, 'Key': object_key, 'ContentType': mime},
            ExpiresIn=3600  # URL will expire in 1 hour (adjust as needed)
        )
        return {
            'statusCode': 200,
            'body': json.dumps({ 'url': presigned_url, 'event': event }),
            'headers': {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Content-Type': 'application/json'
            },
        }
    except ClientError as e:
        return {
            'statusCode': 500,
            'body': f'Error generating presigned URL: {str(e)}'
        }