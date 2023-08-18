FROM public.ecr.aws/lambda/python:3.11

# I use 9.5.0 because the current version has a bug: https://github.com/JaidedAI/EasyOCR/issues/1077
RUN pip install Pillow==9.5.0
# Copy function code
COPY app.py ${LAMBDA_TASK_ROOT}

# Set the CMD to your handler (could also be done as a parameter override outside of the Dockerfile)
CMD [ "app.handler" ]
