import os
import random
import boto3
import io
from PIL import Image

s3 = boto3.client('s3')

OUTPUT_BUCKET = os.environ["OUTPUT_BUCKET"]
INPUT_BUCKET = os.environ["INPUT_BUCKET"]

def handler(event, context):
    input_image_path = event['image']
    output_image_path = 'collage.png'

    # Load or create output image from S3
    if s3_image_exists(output_image_path, OUTPUT_BUCKET):
        output_image = download_image_from_s3(output_image_path, OUTPUT_BUCKET)
    else:
        output_image = create_blank_image()

    # Load input image from S3
    input_image = download_image_from_s3(input_image_path, INPUT_BUCKET)

    output_width, output_height = output_image.size
    input_width, input_height = input_image.size

    # crop_... represents the coordinates of the bounding box of the detected object.
    coordinates = event['rekognitionOutput']['Labels'][0]['Instances'][0]['BoundingBox']
    crop_top = int(coordinates['Top'] * input_height)
    crop_left = int(coordinates['Left'] * input_width)
    crop_width = int(coordinates['Width'] * input_width)
    crop_height = int(coordinates['Height'] * input_height)

    # Generate a random position and size for the input image within the output image.
    min_size = int(min(output_width, output_height) * 0.1)
    max_size = int(min(output_width, output_height) * 0.3)
    new_width = random.randint(min_size, max_size)
    new_height = int(new_width * (crop_height / crop_width))
    x_position = random.randint(0, output_width - new_width)
    y_position = random.randint(0, output_height - new_height)

    
    rotation_angle = random.uniform(-20, 20)

    # Copy the specified portion of the input image
    copied_portion = input_image.convert(
        'RGBA'
    ).crop(
        (crop_left, crop_top, crop_left + crop_width, crop_top + crop_height)
    ).rotate(
        rotation_angle, expand=True, fillcolor=(0, 0, 0, 0)
    ).resize((new_width, new_height), Image.ANTIALIAS)

    
    # Paste the copied portion onto the output image
    output_image.paste(
        copied_portion,
        (x_position, y_position),
        copied_portion
    )

    # Save the resulting image to S3
    save_image_to_s3(output_image, output_image_path)

    return {
        'statusCode': 200,
        'body': 'Image processed and saved successfully.'
    }

def s3_image_exists(image_path, bucket):
    try:
        s3.head_object(Bucket=bucket, Key=image_path)
        return True
    except:
        return False

def create_blank_image():
    return Image.new('RGBA', (2048, 2048), (0, 0, 0, 0))

def download_image_from_s3(image_path, bucket):
    response = s3.get_object(Bucket=bucket, Key=image_path)
    image_data = response['Body'].read()
    return Image.open(io.BytesIO(image_data))

def save_image_to_s3(image, image_path):
    temp_image_path = '/tmp/temp_output.png'
    image.save(temp_image_path)
    s3.upload_file(temp_image_path, OUTPUT_BUCKET, image_path)
    os.remove(temp_image_path)