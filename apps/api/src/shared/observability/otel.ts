import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
import { DiagConsoleLogger, DiagLogLevel, diag } from '@opentelemetry/api'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { NodeSDK } from '@opentelemetry/sdk-node'

if (process.env.OTEL_TRACES_EXPORTER !== 'none' && process.env.NODE_ENV !== 'test') {
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR)
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318'
  const sdk = new NodeSDK({
    serviceName: 'todo-api',
    traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
    instrumentations: [
      getNodeAutoInstrumentations({ '@opentelemetry/instrumentation-fs': { enabled: false } }),
    ],
  })
  sdk.start()
  process.on('SIGTERM', () => {
    void sdk.shutdown()
  })
}
