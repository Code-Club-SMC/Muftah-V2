import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_protected/hr/payroll/employee/')({
    component: RouteComponent,
    loader: async () => {
        // No prefetching needed on the static index path.
    },
})

function RouteComponent() {
    return <div>Hello "/_protected/hr/payroll/employee/"!</div>
}
