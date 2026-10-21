/** Print the versioned Kionel Enterprise Control Plane OpenAPI document. */
import { controlPlaneOpenApi } from "@kionel/control-plane";

process.stdout.write(`${JSON.stringify(controlPlaneOpenApi(), null, 2)}\n`);
