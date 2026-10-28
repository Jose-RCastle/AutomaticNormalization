CREATE TABLE DetallePedido (
  PedidoId INT NOT NULL,
  ProductoId INT NOT NULL,
  ClienteId INT NOT NULL,
  ClienteNombre NVARCHAR(100) NOT NULL,
  ProductoNombre NVARCHAR(100) NOT NULL,
  Cantidad INT NOT NULL,
  PRIMARY KEY (PedidoId, ProductoId)
);
