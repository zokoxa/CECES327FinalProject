# Chess.com Clone - CECS 327 Final Project

## Overview

This project runs as a Dockerized full-stack application.

## Prerequisites

- Docker Desktop installed and running
- Access to the project's `.env` file (request this from the project owner)

## Quick Start

1. Obtain the `.env` file and place it in the project root directory.
2. From the project root, build and start the containers:

	docker compose up --build

3. Open your browser and go to:

	http://localhost/

## Stopping the App

Press `Ctrl + C` in the terminal where Docker Compose is running.

To remove containers, run:

docker compose down

## Notes

- The first build may take a few minutes.
- If port conflicts occur, stop other services using the same ports and rerun Docker Compose.
