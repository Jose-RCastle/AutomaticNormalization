-- Caso PARCELAS de las diapositivas: las reglas pertenecen al dominio, no a los nombres.
-- @fd PARCELAS: IdPropiedad -> NombreMunicipio, NumeroParcela, Area, Precio, Impuestos
-- @fd PARCELAS: NombreMunicipio, NumeroParcela -> IdPropiedad, Area, Precio, Impuestos
-- @fd PARCELAS: NombreMunicipio -> Impuestos
-- @fd PARCELAS: Area -> Precio
CREATE TABLE PARCELAS (
    IdPropiedad INT NOT NULL PRIMARY KEY,
    NombreMunicipio NVARCHAR(80) NOT NULL,
    NumeroParcela INT NOT NULL,
    Area DECIMAL(12,2) NOT NULL,
    Precio DECIMAL(12,2) NOT NULL,
    Impuestos DECIMAL(12,2) NOT NULL,
    UNIQUE (NombreMunicipio, NumeroParcela)
);
INSERT INTO PARCELAS VALUES
(1,N'Centro',1,100,10000,500),
(2,N'Centro',2,200,20000,500),
(3,N'Norte',1,100,10000,700),
(4,N'Norte',2,300,30000,700);
