FROM mcr.microsoft.com/dotnet/sdk:10.0-alpine AS build
WORKDIR /src
COPY IdentityService.Api.csproj .
# Chi giu runtime goc cua DUNG nen tang container chay (Alpine = musl).
# Confluent.Kafka dong goi librdkafka cho CA 7 nen tang - linux-x64,
# arm64, s390x, win-x64, win-x86, osx-x64, osx-arm64 - het ~103MB, ma
# container nay chi dung duoc mot cai.
RUN dotnet restore -r linux-musl-x64
COPY . .
RUN dotnet publish -c Release -o /app --no-restore -r linux-musl-x64 --self-contained false

FROM mcr.microsoft.com/dotnet/aspnet:10.0-alpine AS runtime
WORKDIR /app
RUN adduser -D -u 1000 appuser
COPY --from=build /app .
USER appuser
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "IdentityService.Api.dll"]
