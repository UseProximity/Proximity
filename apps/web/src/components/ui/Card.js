export const Card = ({ children, className = "", onClick }) => (
  <div
    className={`bg-white rounded-lg border border-gray-200 shadow-sm ${className}`}
    onClick={onClick}
  >
    {children}
  </div>
);

export const CardHeader = ({ children, className = "" }) => (
  <div className={`p-6 pb-2 ${className}`}>{children}</div>
);

export const CardContent = ({ children, className = "" }) => (
  <div className={`p-6 pt-0 ${className}`}>{children}</div>
);

export const CardTitle = ({ children, className = "" }) => (
  <h3
    className={`text-lg font-semibold leading-none tracking-tight ${className}`}
  >
    {children}
  </h3>
);
